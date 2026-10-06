package com.quicktest.workspace;

import org.springframework.stereotype.Component;

@Component
public class ProfileExamMutex {
    private final WorkspaceStore db;
    public ProfileExamMutex(WorkspaceStore db) { this.db=db; }
    public void lock(long user) {
        // A dedicated row avoids taking exclusive locks on a parent of all memberships.
        db.update("INSERT INTO profile_exam_locks(user_id) VALUES(?) ON DUPLICATE KEY UPDATE user_id=user_id",user);
        db.one("SELECT user_id FROM profile_exam_locks WHERE user_id=? FOR UPDATE",user);
    }
}
