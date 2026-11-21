package com.quicktest.workspace;

import com.quicktest.workspace.repository.IdentityRepository;

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
import static com.quicktest.workspace.WorkspaceValues.*;

@Service
public class IdentityWorkflow {
    private final IdentityRepository repository;
    private final WorkspaceCrypto crypto;
    private final NotificationService notifications;
    private final AppUserRepository users;
    private final AuthTokenRepository tokens;
    private final PasswordEncoder passwords;
    private final Clock clock;
    public IdentityWorkflow(IdentityRepository repository,WorkspaceCrypto crypto,NotificationService notifications,AppUserRepository users,AuthTokenRepository tokens,PasswordEncoder passwords,Clock clock) {
        this.repository=repository;this.crypto=crypto;this.notifications=notifications;this.users=users;this.tokens=tokens;this.passwords=passwords;this.clock=clock;
    }
    public void initialize(AppUser user) {
        if(repository.countNotificationAddresses(user.getId())==0) repository.insertNotificationAddress(user.getId(), user.getEmail(), user.getEmailVerifiedAt());
    }
    public Map<String,Object> profile(AppUser user) {
        initialize(user);
        return repository.requireNotificationAddress(user.getId());
    }
    /** Admin view of each user's notification address; users without a row fall back to the login email, as initialize would. */
    public Map<Long,NotificationAddress> notificationAddresses() {
        Map<Long,NotificationAddress> addresses=new java.util.HashMap<>();
        for(var row:repository.findNotificationAddresses()) addresses.put(number(row,"user_id"),address(row));
        return addresses;
    }
    public NotificationAddress notificationAddress(AppUser user) {
        return repository.findNotificationAddress(user.getId()).map(IdentityWorkflow::address).orElseGet(()->fallback(user));
    }
    public static NotificationAddress fallback(AppUser user) { return new NotificationAddress(user.getEmail(),user.getEmailVerifiedAt()); }
    /** Sends a new verification link to the user's current, still unverified notification address. */
    @Transactional
    public String sendVerification(AppUser user) {
        initialize(user);
        var address=repository.requireNotificationAddress(user.getId());
        if(address.get("verified_at")!=null) throw WorkspaceError.conflict("Имейлът за известия вече е потвърден.");
        String email=string(address,"email");
        challenge(user.getId(),"notification_email",email);
        return email;
    }
    /** Confirms only the displayed current address; the caller holds the target user's lock. */
    @Transactional
    public boolean confirmNotificationAddress(AppUser user,String expectedEmail) {
        // Verification links lock challenges before the address; use the same order here.
        repository.lockNotificationChallenges(user.getId());
        initialize(user);
        var address=repository.lockNotificationAddress(user.getId());
        String email=string(address,"email");
        if(!email.equalsIgnoreCase(expectedEmail)) throw WorkspaceError.conflict("Имейлът за известия е променен. Обновете списъка и опитайте отново.");
        if(address.get("verified_at")!=null) return false;
        var now=clock.instant();
        repository.verifyAddress(email,now,user.getId());
        repository.consumePurposeChallenges(now,user.getId(),"notification_email");
        if(email.equalsIgnoreCase(user.getEmail()) && user.getEmailVerifiedAt()==null) user.setEmailVerifiedAt(now);
        return true;
    }
    public java.util.List<Map<String,Object>> identities(AppUser user) {
        return repository.findExternalIdentities(user.getId());
    }
    @Transactional
    public void requestEmail(AppUser user,String email,String password) {
        if(!passwords.matches(password,user.getPasswordHash())) throw WorkspaceError.forbidden();
        initialize(user); challenge(user.getId(),"notification_email",email.trim().toLowerCase(Locale.ROOT));
    }
    @Transactional
    public void verify(String token) {
        var challenge=repository.lockChallenge(crypto.hash(token));
        if(!string(challenge,"purpose").equals("notification_email") || challenge.get("consumed_at")!=null || !clock.instant().isBefore(time(challenge,"expires_at"))) throw WorkspaceError.expired("Невалидно или изтекло потвърждение.");
        repository.verifyAddress(string(challenge,"pending_email"), clock.instant(), number(challenge,"user_id"));
        repository.consumeChallenge(clock.instant(), crypto.hash(token));
    }
    @Transactional
    public void recover(String email) {
        users.findByEmailIgnoreCase(email).filter(AppUser::isActive).ifPresent(user->challenge(user.getId(),"password_recovery",user.getEmail()));
    }
    @Transactional
    public void reset(String token,String password) {
        if(password.length()<8 || password.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>72) throw WorkspaceError.validation("Парола: поне 8 символа, до 72 UTF-8 байта.");
        var challenge=repository.lockChallenge(crypto.hash(token));
        if(!string(challenge,"purpose").equals("password_recovery") || challenge.get("consumed_at")!=null || !clock.instant().isBefore(time(challenge,"expires_at"))) throw WorkspaceError.expired("Невалиден или изтекъл линк.");
        var user=users.findById(number(challenge,"user_id")).orElseThrow(WorkspaceError::notFound);
        user.setPasswordHash(passwords.encode(password));user.setPasswordChangeRequired(false);users.save(user);tokens.deleteByUserId(user.getId());
        repository.consumeRecoveryChallenges(clock.instant(), user.getId());
    }
    @Transactional
    public void registration(AppUser user) { initialize(user);challenge(user.getId(),"notification_email",user.getEmail()); }
    private static NotificationAddress address(Map<String,Object> row) {
        return new NotificationAddress(string(row,"email"),row.get("verified_at")==null?null:time(row,"verified_at"));
    }
    public record NotificationAddress(String email,java.time.Instant verifiedAt) {}
    private void challenge(long user,String purpose,String email) {
        String token=crypto.token();
        repository.consumePurposeChallenges(clock.instant(), user, purpose);
        repository.insertChallenge(crypto.hash(token), user, purpose, email, clock.instant().plus(Duration.ofHours(1)));
        notifications.enqueue(null,null,user,purpose,email,Map.of("token",token,"purpose",purpose,"expires_at",clock.instant().plus(Duration.ofHours(1)).toString()));
    }
}
