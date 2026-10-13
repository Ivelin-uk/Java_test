package com.quicktest.workspace.repository;

import com.quicktest.workspace.WorkspaceStore;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.*;

@Repository
public class IdentityRepository {
    private final WorkspaceStore store;

    public IdentityRepository(WorkspaceStore store) {
        this.store = store;
    }

    public List<Map<String, Object>> findExternalIdentities(long userId) {
        return store.rows("SELECT provider,linked_at FROM external_identities WHERE user_id=?", userId);
    }

    public long countNotificationAddresses(Long userId) {
        return store.count("SELECT COUNT(*) FROM notification_addresses WHERE user_id=?", userId);
    }

    public int insertNotificationAddress(Long userId, String getEmail, Instant getEmailVerifiedAt) {
        return store.update("INSERT INTO notification_addresses(user_id,email,verified_at) VALUES(?,?,?)", userId, getEmail, getEmailVerifiedAt);
    }

    public Map<String, Object> requireNotificationAddress(Long userId) {
        return store.one("SELECT email,verified_at FROM notification_addresses WHERE user_id=?", userId);
    }

    public Map<String, Object> lockChallenge(String value) {
        return store.one("SELECT * FROM identity_challenges WHERE token_hash=? FOR UPDATE", value);
    }

    public int verifyAddress(String pendingEmail, Instant timestamp, long userId) {
        return store.update("UPDATE notification_addresses SET email=?,verified_at=? WHERE user_id=?", pendingEmail, timestamp, userId);
    }

    public int consumeChallenge(Instant timestamp, String value) {
        return store.update("UPDATE identity_challenges SET consumed_at=? WHERE token_hash=?", timestamp, value);
    }

    public int consumeRecoveryChallenges(Instant timestamp, Long userId) {
        return store.update("UPDATE identity_challenges SET consumed_at=? WHERE user_id=? AND purpose='password_recovery' AND consumed_at IS NULL", timestamp, userId);
    }

    public int consumePurposeChallenges(Instant timestamp, long user, String purpose) {
        return store.update("UPDATE identity_challenges SET consumed_at=? WHERE user_id=? AND purpose=? AND consumed_at IS NULL", timestamp, user, purpose);
    }

    public int insertChallenge(String value, long user, String purpose, String email, Instant value2) {
        return store.update("INSERT INTO identity_challenges(token_hash,user_id,purpose,pending_email,expires_at) VALUES(?,?,?,?,?)", value, user, purpose, email, value2);
    }
}
