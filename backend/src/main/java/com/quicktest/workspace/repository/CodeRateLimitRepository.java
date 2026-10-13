package com.quicktest.workspace.repository;

import com.quicktest.workspace.WorkspaceStore;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.*;

@Repository
public class CodeRateLimitRepository {
    private final WorkspaceStore store;

    public CodeRateLimitRepository(WorkspaceStore store) {
        this.store = store;
    }

    public int ensureBucket(String key, Instant value) {
        return store.update("INSERT INTO workspace_rate_limits(bucket_key,failures,expires_at) VALUES(?,0,?) ON DUPLICATE KEY UPDATE bucket_key=VALUES(bucket_key)", key, value);
    }

    public Map<String, Object> lockBucket(String key) {
        return store.one("SELECT * FROM workspace_rate_limits WHERE bucket_key=? FOR UPDATE", key);
    }

    public int resetBucket(Instant value, String key) {
        return store.update("UPDATE workspace_rate_limits SET failures=0,expires_at=? WHERE bucket_key=?", value, key);
    }

    public int incrementFailures(String key) {
        return store.update("UPDATE workspace_rate_limits SET failures=failures+1 WHERE bucket_key=?", key);
    }
}
