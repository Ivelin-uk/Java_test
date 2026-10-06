package com.quicktest.workspace;

import com.quicktest.auth.AppUser;
import com.quicktest.auth.AppUserRepository;
import com.quicktest.auth.AuthTokenRepository;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Clock;
import java.time.Duration;
import java.util.Map;
import java.util.Locale;
import static com.quicktest.workspace.WorkspaceStore.*;

@Service
public class IdentityWorkflow {
    private final WorkspaceStore db;
    private final WorkspaceCrypto crypto;
    private final NotificationService notifications;
    private final AppUserRepository users;
    private final AuthTokenRepository tokens;
    private final PasswordEncoder passwords;
    private final Clock clock;
    public IdentityWorkflow(WorkspaceStore db,WorkspaceCrypto crypto,NotificationService notifications,AppUserRepository users,AuthTokenRepository tokens,PasswordEncoder passwords,Clock clock) {
        this.db=db;this.crypto=crypto;this.notifications=notifications;this.users=users;this.tokens=tokens;this.passwords=passwords;this.clock=clock;
    }
    public void initialize(AppUser user) {
        if(db.count("SELECT COUNT(*) FROM notification_addresses WHERE user_id=?",user.getId())==0) db.update("INSERT INTO notification_addresses(user_id,email,verified_at) VALUES(?,?,?)",user.getId(),user.getEmail(),user.getEmailVerifiedAt());
    }
    public Map<String,Object> profile(AppUser user) {
        initialize(user);
        return db.one("SELECT email,verified_at FROM notification_addresses WHERE user_id=?",user.getId());
    }
    @Transactional
    public void requestEmail(AppUser user,String email,String password) {
        if(!passwords.matches(password,user.getPasswordHash())) throw WorkspaceError.forbidden();
        initialize(user); challenge(user.getId(),"notification_email",email.trim().toLowerCase(Locale.ROOT));
    }
    @Transactional
    public void verify(String token) {
        var challenge=db.one("SELECT * FROM identity_challenges WHERE token_hash=? FOR UPDATE",crypto.hash(token));
        if(!string(challenge,"purpose").equals("notification_email") || challenge.get("consumed_at")!=null || !clock.instant().isBefore(time(challenge,"expires_at"))) throw WorkspaceError.expired("Невалидно или изтекло потвърждение.");
        db.update("UPDATE notification_addresses SET email=?,verified_at=? WHERE user_id=?",string(challenge,"pending_email"),clock.instant(),number(challenge,"user_id"));
        db.update("UPDATE identity_challenges SET consumed_at=? WHERE token_hash=?",clock.instant(),crypto.hash(token));
    }
    @Transactional
    public void recover(String email) {
        users.findByEmailIgnoreCase(email).filter(AppUser::isActive).ifPresent(user->challenge(user.getId(),"password_recovery",user.getEmail()));
    }
    @Transactional
    public void reset(String token,String password) {
        if(password.length()<8 || password.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>72) throw WorkspaceError.validation("Парола: поне 8 символа, до 72 UTF-8 байта.");
        var challenge=db.one("SELECT * FROM identity_challenges WHERE token_hash=? FOR UPDATE",crypto.hash(token));
        if(!string(challenge,"purpose").equals("password_recovery") || challenge.get("consumed_at")!=null || !clock.instant().isBefore(time(challenge,"expires_at"))) throw WorkspaceError.expired("Невалиден или изтекъл линк.");
        var user=users.findById(number(challenge,"user_id")).orElseThrow(WorkspaceError::notFound);
        user.setPasswordHash(passwords.encode(password));user.setPasswordChangeRequired(false);users.save(user);tokens.deleteByUserId(user.getId());
        db.update("UPDATE identity_challenges SET consumed_at=? WHERE user_id=? AND purpose='password_recovery' AND consumed_at IS NULL",clock.instant(),user.getId());
    }
    @Transactional
    public void registration(AppUser user) { initialize(user);challenge(user.getId(),"notification_email",user.getEmail()); }
    private void challenge(long user,String purpose,String email) {
        String token=crypto.token();
        db.update("UPDATE identity_challenges SET consumed_at=? WHERE user_id=? AND purpose=? AND consumed_at IS NULL",clock.instant(),user,purpose);
        db.update("INSERT INTO identity_challenges(token_hash,user_id,purpose,pending_email,expires_at) VALUES(?,?,?,?,?)",crypto.hash(token),user,purpose,email,clock.instant().plus(Duration.ofHours(1)));
        notifications.enqueue(null,null,user,purpose,email,Map.of("token",token,"purpose",purpose,"expires_at",clock.instant().plus(Duration.ofHours(1)).toString()));
    }
}
