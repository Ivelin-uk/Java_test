package com.quicktest.workspace.repository;

import com.quicktest.workspace.WorkspaceStore;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.*;

@Repository
public class GoogleIdentityRepository {
    private final WorkspaceStore store;

    public GoogleIdentityRepository(WorkspaceStore store) {
        this.store = store;
    }

    public int insertLinkChallenge(String value, Long userId, Instant value2, String value3) {
        return store.update("INSERT INTO identity_challenges(token_hash,user_id,purpose,expires_at,auth_session_hash) VALUES(?,?,'google_link',?,?)", value, userId, value2, value3);
    }

    public int consumeChallenge(Instant timestamp, String value) {
        return store.update("UPDATE identity_challenges SET consumed_at=? WHERE token_hash=?", timestamp, value);
    }

    public Optional<Map<String, Object>> findGoogleIdentityForUpdate(String subject) {
        return store.optional("SELECT user_id FROM external_identities WHERE provider='google' AND subject=? FOR UPDATE", subject);
    }

    public List<Map<String, Object>> findRecentSessions(Long linkUser, Instant value) {
        return store.rows("SELECT token FROM auth_token WHERE user_id=? AND created_at>?", linkUser, value);
    }

    public long countGoogleIdentities(Long linkUser) {
        return store.count("SELECT COUNT(*) FROM external_identities WHERE user_id=? AND provider='google'", linkUser);
    }

    public long insertGoogleIdentity(long user, String subject, Instant timestamp) {
        return store.insert("INSERT INTO external_identities(user_id,provider,subject,linked_at) VALUES(?,\'google\',?,?)", user, subject, timestamp);
    }

    public int insertHandoffChallenge(String value, long user, Instant value2) {
        return store.update("INSERT INTO identity_challenges(token_hash,user_id,purpose,expires_at) VALUES(?,?,'google_handoff',?)", value, user, value2);
    }

    public Map<String, Object> lockChallenge(String value) {
        return store.one("SELECT * FROM identity_challenges WHERE token_hash=? FOR UPDATE", value);
    }
}
