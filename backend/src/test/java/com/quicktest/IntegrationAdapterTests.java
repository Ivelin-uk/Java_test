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
        assertThrows(WorkspaceError.class,()->google.complete(oidc,null,null));assertEquals(0,db.count("SELECT COUNT(*) FROM external_identities WHERE subject=?",subject));
        String authorization="Bearer "+auth.login(new AuthService.LoginRequest(user.getEmail(),"password123")).token();
        assertThrows(WorkspaceError.class,()->google.linkingTicket(user,"wrong",authorization));
        String ticket=google.linkingTicket(user,"password123",authorization);var linked=google.consumeLink(ticket);assertThrows(WorkspaceError.class,()->google.consumeLink(ticket));
        String handoff=google.complete(oidc,number(linked,"user"),string(linked,"sessionHash"));var response=google.exchange(handoff);assertEquals(user.getId(),response.user().id());assertThrows(WorkspaceError.class,()->google.exchange(handoff));
        var attacker=user();String attackerAuth="Bearer "+auth.login(new AuthService.LoginRequest(attacker.getEmail(),"password123")).token();var attackerTicket=google.consumeLink(google.linkingTicket(attacker,"password123",attackerAuth));assertThrows(WorkspaceError.class,()->google.complete(oidc,attacker.getId(),string(attackerTicket,"sessionHash")));
    }
    @Test void stripeSignaturesAreCheckedAgainstUnmodifiedBody() throws Exception {
        String secret="whsec_local_signature_fixture",timestamp=Long.toString(Instant.now().getEpochSecond());
        var adapter=new StripeTestGateway(db,"sk_test_local_fixture",secret);
        String body="{\"id\":\"evt_fixture\",\"object\":\"event\",\"created\":"+timestamp+",\"livemode\":false,\"type\":\"customer.subscription.created\",\"data\":{\"object\":{\"id\":\"sub_fixture\",\"object\":\"subscription\"}}}";
        Mac hmac=Mac.getInstance("HmacSHA256");hmac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8),"HmacSHA256"));String signature="t="+timestamp+",v1="+HexFormat.of().formatHex(hmac.doFinal((timestamp+"."+body).getBytes(StandardCharsets.UTF_8)));
        assertEquals("evt_fixture",string(adapter.verifyWebhook(body,signature),"id"));assertThrows(WorkspaceError.class,()->adapter.verifyWebhook(body+" ",signature));assertThrows(WorkspaceError.class,()->adapter.verifyWebhook(body,"t="+timestamp+",v1=bad"));
    }
    @Test void localBillingEventsDeduplicateRejectStaleStateAndPreservePaidCancellation() {
        var user=user();long org=number(organizations.create(user.getId(),new OrganizationService.OrganizationRequest("Billing test","school",user.getEmail(),"Europe/Sofia","Ученик")),"id");long plan=number(organizations.subscription(org),"plan_id");
        var service=new BillingService(db,gateway,audit,clock,organizations,"http://localhost:5173",true);Instant now=Instant.now();
        var active=new BillingService.Fixture("evt_active_"+org,200,new BillingService.Snapshot(plan,"active",now,now.plusSeconds(30*86400),false));service.fixture(user.getId(),org,active);service.fixture(user.getId(),org,active);
        service.fixture(user.getId(),org,new BillingService.Fixture("evt_old_"+org,100,new BillingService.Snapshot(plan,"expired",now,now.minusSeconds(1),false)));assertEquals("active",string(organizations.subscription(org),"status"));
        service.fixture(user.getId(),org,new BillingService.Fixture("evt_cancel_"+org,300,new BillingService.Snapshot(plan,"canceled",now,now.plusSeconds(1),true)));assertTrue(time(organizations.subscription(org),"paid_through").isAfter(now.plusSeconds(86400)));organizations.requirePaid(org);assertEquals(3,db.count("SELECT COUNT(*) FROM workspace_billing_events WHERE organization_id=?",org));
    }
    @Test void unknownMailOutcomeIsNotAutomaticallyRetried() {
        var user=user();long id=db.insert("INSERT INTO notification_outbox(user_id,notification_type,recipient_email,payload_json,available_at,created_at) VALUES(?,'final_result',?,'{}',?,?)",user.getId(),user.getEmail(),Instant.now(),Instant.now());
        var worker=new NotificationService(db,clock,transactions,(notification,email,payload)->{throw new IllegalStateException("simulated timeout");},true,"local");worker.deliver();worker.deliver();
        var result=db.one("SELECT status,attempts FROM notification_outbox WHERE id=?",id);assertEquals("uncertain",string(result,"status"));assertEquals(1,number(result,"attempts"));
    }
}
