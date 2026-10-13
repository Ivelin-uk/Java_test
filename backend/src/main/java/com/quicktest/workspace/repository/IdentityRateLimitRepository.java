package com.quicktest.workspace.repository;

import com.quicktest.workspace.WorkspaceStore;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.*;

@Repository
public class IdentityRateLimitRepository {
    private final WorkspaceStore store;

    public IdentityRateLimitRepository(WorkspaceStore store) {
        this.store = store;
    }

    public int ensureBucket(String bucket, Instant value) {
        return store.update("INSERT INTO workspace_rate_limits(bucket_key,failures,expires_at) VALUES(?,0,?) ON DUPLICATE KEY UPDATE bucket_key=bucket_key", bucket, value);
    }

    public Map<String, Object> lockBucket(String bucket) {
        return store.one("SELECT * FROM workspace_rate_limits WHERE bucket_key=? FOR UPDATE", bucket);
    }

    public int updateBucket(long value, Object value2, String bucket) {
        return store.update("UPDATE workspace_rate_limits SET failures=?,expires_at=? WHERE bucket_key=?", value, value2, bucket);
    }
}
