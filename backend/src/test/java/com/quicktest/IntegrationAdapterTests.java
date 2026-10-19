package com.quicktest;

import com.quicktest.auth.*;
import com.quicktest.workspace.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser;
import org.springframework.transaction.support.TransactionTemplate;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import static com.quicktest.workspace.WorkspaceStore.*;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(properties={"spring.datasource.url=jdbc:h2:mem:adapter_tests;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1","app.workspace.workers=false"})
class IntegrationAdapterTests {
    @Autowired WorkspaceStore db;
    @Autowired WorkspaceJson workspaceJson;
    @Autowired com.quicktest.workspace.repository.NotificationRepository notificationRepository;
    @Autowired com.quicktest.workspace.repository.BillingRepository billingRepository;
    @Autowired AppUserRepository users;
    @Autowired PasswordEncoder passwords;
    @Autowired GoogleIdentityService google;
    @Autowired AuthService auth;
    @Autowired IdentityWorkflow identity;
    @Autowired OrganizationService organizations;
    @Autowired WorkspaceAudit audit;
    @Autowired Clock clock;
    @Autowired PaymentGateway gateway;
    @Autowired TransactionTemplate transactions;

    private AppUser user() {
        var user=new AppUser();user.setEmail(UUID.randomUUID()+"@example.test");user.setName("Integration test");user.setPasswordHash(passwords.encode("password123"));user.setEmailVerifiedAt(Instant.now());users.saveAndFlush(user);identity.initialize(user);return user;
    }
    private DefaultOidcUser oidc(String subject,String email) {
        Instant now=Instant.now();return new DefaultOidcUser(List.of(),new OidcIdToken("framework-validated-token-fixture",now,now.plusSeconds(120),Map.of("iss","https://accounts.google.com","sub",subject,"email",email,"email_verified",true)));
    }
    @Test void googleMatchingEmailDoesNotMergeAndExplicitLinkRequiresReauthentication() {
        var user=user();String subject=UUID.randomUUID().toString();var oidc=oidc(subject,user.getEmail());
        assertThrows(WorkspaceError.class,()->google.complete(oidc,null,null,Role.STUDENT));assertEquals(0,db.count("SELECT COUNT(*) FROM external_identities WHERE subject=?",subject));
        String authorization="Bearer "+auth.login(new AuthService.LoginRequest(user.getEmail(),"password123")).token();
        assertThrows(WorkspaceError.class,()->google.linkingTicket(user,"wrong",authorization));
        String ticket=google.linkingTicket(user,"password123",authorization);var linked=google.consumeLink(ticket);assertThrows(WorkspaceError.class,()->google.consumeLink(ticket));
        String handoff=google.complete(oidc,number(linked,"user"),string(linked,"sessionHash"),Role.TEACHER);var response=google.exchange(handoff);assertEquals(user.getId(),response.user().id());assertEquals("STUDENT",response.user().role());assertThrows(WorkspaceError.class,()->google.exchange(handoff));
        var attacker=user();String attackerAuth="Bearer "+auth.login(new AuthService.LoginRequest(attacker.getEmail(),"password123")).token();var attackerTicket=google.consumeLink(google.linkingTicket(attacker,"password123",attackerAuth));assertThrows(WorkspaceError.class,()->google.complete(oidc,attacker.getId(),string(attackerTicket,"sessionHash"),Role.STUDENT));
    }
    @Test void googleRegistrationCreatesVerifiedProfilesWithSelectedRoleAndNoDuplicateOnLogin() {
        for(Role role:List.of(Role.STUDENT,Role.TEACHER)) {
            String subject=UUID.randomUUID().toString(),email="Google-"+UUID.randomUUID()+"@example.test";
            var principal=oidc(subject,email);
            var first=google.exchange(google.complete(principal,null,null,role));
            assertEquals(role.name(),first.user().role());assertEquals(email.toLowerCase(Locale.ROOT),first.user().email());
            var profile=users.findById(first.user().id()).orElseThrow();assertNotNull(profile.getEmailVerifiedAt());
            assertNotNull(db.one("SELECT verified_at FROM notification_addresses WHERE user_id=?",profile.getId()).get("verified_at"));
            var second=google.exchange(google.complete(principal,null,null,role==Role.STUDENT?Role.TEACHER:Role.STUDENT));
            assertEquals(first.user().id(),second.user().id());assertEquals(role.name(),second.user().role());
            assertEquals(1,db.count("SELECT COUNT(*) FROM external_identities WHERE subject=?",subject));
        }
    }
    @Test void googleRegistrationRejectsUnverifiedEmailInvalidIssuerAndAdminRole() {
        String subject=UUID.randomUUID().toString(),email=UUID.randomUUID()+"@example.test";
        Instant now=Instant.now();
        for(var claims:List.of(
                Map.<String,Object>of("iss","https://accounts.google.com","sub",subject,"email",email,"email_verified",false),
                Map.<String,Object>of("iss","https://invalid.example.test","sub",subject,"email",email,"email_verified",true),
                Map.<String,Object>of("iss","https://accounts.google.com","sub",subject,"email"," ","email_verified",true))) {
            var principal=new DefaultOidcUser(List.of(),new OidcIdToken("framework-fixture",now,now.plusSeconds(120),claims));
            assertThrows(WorkspaceError.class,()->google.complete(principal,null,null,Role.STUDENT));
        }
        assertThrows(WorkspaceError.class,()->google.complete(oidc(subject,email),null,null,Role.ADMIN));
        assertFalse(users.existsByEmailIgnoreCase(email));assertEquals(0,db.count("SELECT COUNT(*) FROM external_identities WHERE subject=?",subject));
    }
    @Test void googleLoginAndHandoffExchangeRespectAccountDeactivation() {
        var principal=oidc(UUID.randomUUID().toString(),UUID.randomUUID()+"@example.test");
        String handoff=google.complete(principal,null,null,null);
        long user=number(db.one("SELECT user_id FROM external_identities WHERE subject=?",principal.getSubject()),"user_id");
        assertEquals(Role.STUDENT,users.findById(user).orElseThrow().getRole());
        db.update("UPDATE users SET active=false WHERE id=?",user);
        assertThrows(org.springframework.web.server.ResponseStatusException.class,()->google.exchange(handoff));
        assertThrows(WorkspaceError.class,()->google.complete(principal,null,null,Role.TEACHER));
    }
    @Test void stripeSignaturesAreCheckedAgainstUnmodifiedBody() throws Exception {
        String secret="whsec_local_signature_fixture",timestamp=Long.toString(Instant.now().getEpochSecond());
        var adapter=new StripeTestGateway(workspaceJson,"sk_test_local_fixture",secret);
        String body="{\"id\":\"evt_fixture\",\"object\":\"event\",\"created\":"+timestamp+",\"livemode\":false,\"type\":\"customer.subscription.created\",\"data\":{\"object\":{\"id\":\"sub_fixture\",\"object\":\"subscription\"}}}";
        Mac hmac=Mac.getInstance("HmacSHA256");hmac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8),"HmacSHA256"));String signature="t="+timestamp+",v1="+HexFormat.of().formatHex(hmac.doFinal((timestamp+"."+body).getBytes(StandardCharsets.UTF_8)));
        assertEquals("evt_fixture",string(adapter.verifyWebhook(body,signature),"id"));assertThrows(WorkspaceError.class,()->adapter.verifyWebhook(body+" ",signature));assertThrows(WorkspaceError.class,()->adapter.verifyWebhook(body,"t="+timestamp+",v1=bad"));
    }
    @Test void localBillingEventsDeduplicateRejectStaleStateAndPreservePaidCancellation() {
        var user=user();long org=number(organizations.create(user.getId(),new OrganizationService.OrganizationRequest("Billing test","school",user.getEmail(),"Europe/Sofia","Ученик")),"id");long plan=number(organizations.subscription(org),"plan_id");
        var service=new BillingService(billingRepository,workspaceJson,gateway,audit,clock,organizations,"http://localhost:5173",true);Instant now=Instant.now();
        var active=new BillingService.Fixture("evt_active_"+org,200,new BillingService.Snapshot(plan,"active",now,now.plusSeconds(30*86400),false));service.fixture(user.getId(),org,active);service.fixture(user.getId(),org,active);
        service.fixture(user.getId(),org,new BillingService.Fixture("evt_old_"+org,100,new BillingService.Snapshot(plan,"expired",now,now.minusSeconds(1),false)));assertEquals("active",string(organizations.subscription(org),"status"));
        service.fixture(user.getId(),org,new BillingService.Fixture("evt_cancel_"+org,300,new BillingService.Snapshot(plan,"canceled",now,now.plusSeconds(1),true)));assertTrue(time(organizations.subscription(org),"paid_through").isAfter(now.plusSeconds(86400)));organizations.requirePaid(org);assertEquals(3,db.count("SELECT COUNT(*) FROM workspace_billing_events WHERE organization_id=?",org));
    }
    @Test void unknownMailOutcomeIsNotAutomaticallyRetried() {
        var user=user();long id=db.insert("INSERT INTO notification_outbox(user_id,notification_type,recipient_email,payload_json,available_at,created_at) VALUES(?,'final_result',?,'{}',?,?)",user.getId(),user.getEmail(),Instant.now(),Instant.now());
        var worker=new NotificationService(notificationRepository,workspaceJson,clock,transactions,(notification,email,payload)->{throw new IllegalStateException("simulated timeout");},true,"local");worker.deliver();worker.deliver();
        var result=db.one("SELECT status,attempts FROM notification_outbox WHERE id=?",id);assertEquals("uncertain",string(result,"status"));assertEquals(1,number(result,"attempts"));
    }
    @Test void rejectedHttpsMailRetriesBoundedlyWithoutDuplicatingTheMessage() {
        var user=user();long id=db.insert("INSERT INTO notification_outbox(user_id,notification_type,recipient_email,payload_json,available_at,created_at) VALUES(?,'final_result',?,'{}',?,?)",user.getId(),user.getEmail(),Instant.now(),Instant.now());
        var worker=new NotificationService(notificationRepository,workspaceJson,clock,transactions,(notification,email,payload)->{throw new MailDeliveryRejected();},true,"resend");
        for(int attempt=1;attempt<=3;attempt++) {
            db.update("UPDATE notification_outbox SET available_at=? WHERE id=?",Instant.now().minusSeconds(1),id);worker.deliver();
            var result=db.one("SELECT status,attempts FROM notification_outbox WHERE id=?",id);assertEquals(attempt,number(result,"attempts"));assertEquals(attempt<3?"queued":"failed",string(result,"status"));
        }
        worker.deliver();assertEquals(3,number(db.one("SELECT attempts FROM notification_outbox WHERE id=?",id),"attempts"));
    }
}
