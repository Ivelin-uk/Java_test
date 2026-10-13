package com.quicktest.workspace.repository;

import com.quicktest.workspace.WorkspaceStore;
import org.springframework.stereotype.Repository;

import java.util.*;

@Repository
public class ProfileExamLockRepository {
    private final WorkspaceStore store;

    public ProfileExamLockRepository(WorkspaceStore store) {
        this.store = store;
    }

    public int ensureLock(long user) {
        return store.update("INSERT INTO profile_exam_locks(user_id) VALUES(?) ON DUPLICATE KEY UPDATE user_id=user_id", user);
    }

    public Map<String, Object> lockProfile(long user) {
        return store.one("SELECT user_id FROM profile_exam_locks WHERE user_id=? FOR UPDATE", user);
    }
}
