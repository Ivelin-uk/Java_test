package com.quicktest.workspace;

import com.quicktest.auth.*;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Clock;
import java.time.Duration;
import java.util.*;
import static com.quicktest.workspace.WorkspaceStore.*;

@Service
public class GoogleIdentityService {
    private final WorkspaceStore db;private final WorkspaceCrypto crypto;private final AppUserRepository users;
    private final AuthService auth;private final IdentityWorkflow identity;private final PasswordEncoder passwords;private final Clock clock;private final WorkspaceAudit audit;
    public GoogleIdentityService(WorkspaceStore db,WorkspaceCrypto crypto,AppUserRepository users,AuthService auth,IdentityWorkflow identity,PasswordEncoder passwords,Clock clock,WorkspaceAudit audit) {this.db=db;this.crypto=crypto;this.users=users;this.auth=auth;this.identity=identity;this.passwords=passwords;this.clock=clock;this.audit=audit;}
    @Transactional
    public String linkingTicket(AppUser user,String password,String authorization) {
        if(!passwords.matches(password,user.getPasswordHash())) throw WorkspaceError.forbidden();
        String ticket=crypto.token();
        db.update("INSERT INTO identity_challenges(token_hash,user_id,purpose,expires_at,auth_session_hash) VALUES(?,?,'google_link',?,?)",crypto.hash(ticket),user.getId(),clock.instant().plus(Duration.ofMinutes(2)),crypto.hash(authorization));return ticket;
    }
    @Transactional
    public Map<String,Object> consumeLink(String ticket) {
        var challenge=challenge(ticket,"google_link");
        db.update("UPDATE identity_challenges SET consumed_at=? WHERE token_hash=?",clock.instant(),crypto.hash(ticket));
        return Map.of("user",number(challenge,"user_id"),"sessionHash",string(challenge,"auth_session_hash"));
    }
    @Transactional
    public String complete(OidcUser oidc,Long linkUser,String sourceSessionHash) {
        String subject=oidc.getSubject();
        if(subject==null || subject.isBlank() || subject.length()>190 || oidc.getIdToken().getIssuer()==null || !oidc.getIdToken().getIssuer().toString().equals("https://accounts.google.com")) throw WorkspaceError.forbidden();
        var external=db.optional("SELECT user_id FROM external_identities WHERE provider='google' AND subject=? FOR UPDATE",subject);
        long user;
        if(linkUser!=null) {
            var profile=users.findById(linkUser).filter(AppUser::isActive).orElseThrow(WorkspaceError::forbidden);
            boolean current=db.rows("SELECT token FROM auth_token WHERE user_id=? AND created_at>?",linkUser,java.time.Instant.now().minusSeconds(86400)).stream().anyMatch(row->crypto.matches("Bearer "+string(row,"token"),sourceSessionHash));
            if(!current || external.isPresent() && number(external.get(),"user_id")!=linkUser) throw WorkspaceError.forbidden();
            if(db.count("SELECT COUNT(*) FROM external_identities WHERE user_id=? AND provider='google'",linkUser)>0 && external.isEmpty()) throw WorkspaceError.conflict("Вече е свързан друг Google профил.");
            user=profile.getId();
        } else if(external.isPresent()) user=number(external.get(),"user_id");
        else {
            if(!Boolean.TRUE.equals(oidc.getEmailVerified()) || oidc.getEmail()==null || oidc.getEmail().length()>190) throw WorkspaceError.forbidden();
            String email=oidc.getEmail().strip().toLowerCase(Locale.ROOT);
            if(users.existsByEmailIgnoreCase(email)) throw WorkspaceError.conflict("Влезте с парола и свържете Google от профила си.");
            var profile=new AppUser();profile.setEmail(email);profile.setName(Objects.toString(oidc.getFullName(),"Google user").substring(0,Math.min(120,Objects.toString(oidc.getFullName(),"Google user").length())));profile.setPasswordHash(passwords.encode(crypto.token()));profile.setEmailVerifiedAt(clock.instant());users.saveAndFlush(profile);identity.initialize(profile);user=profile.getId();
        }
        if(external.isEmpty()) {long linked=db.insert("INSERT INTO external_identities(user_id,provider,subject,linked_at) VALUES(?,\'google\',?,?)",user,subject,clock.instant());audit.write(null,user,"identity.google_linked",linked,Map.of("provider","google"));}
        if(!users.findById(user).orElseThrow().isActive()) throw WorkspaceError.forbidden();
        String handoff=crypto.token();db.update("INSERT INTO identity_challenges(token_hash,user_id,purpose,expires_at) VALUES(?,?,'google_handoff',?)",crypto.hash(handoff),user,clock.instant().plusSeconds(60));return handoff;
    }
    @Transactional
    public AuthService.AuthResponse exchange(String handoff) {
        var challenge=challenge(handoff,"google_handoff");db.update("UPDATE identity_challenges SET consumed_at=? WHERE token_hash=?",clock.instant(),crypto.hash(handoff));return auth.externalLogin(number(challenge,"user_id"));
    }
    private Map<String,Object> challenge(String raw,String purpose) {
        if(raw==null || raw.length()>100) throw WorkspaceError.validation("Невалиден токен.");
        var row=db.one("SELECT * FROM identity_challenges WHERE token_hash=? FOR UPDATE",crypto.hash(raw));
        if(!string(row,"purpose").equals(purpose) || row.get("consumed_at")!=null || !clock.instant().isBefore(time(row,"expires_at"))) throw WorkspaceError.expired("Изтекла или използвана идентификация.");return row;
    }
}
