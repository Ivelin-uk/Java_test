package com.quicktest.workspace.repository;

import com.quicktest.workspace.WorkspaceStore;
import org.springframework.stereotype.Repository;
import java.time.Instant;
import java.util.*;

@Repository
public class TeacherEntitlementRepository {
    private final WorkspaceStore store;
    public TeacherEntitlementRepository(WorkspaceStore store) { this.store=store; }
    public boolean personalWorkspace(long organization) {
        return store.count("SELECT COUNT(*) FROM personal_workspaces WHERE organization_id=?",organization)>0;
    }
    public void lock(long user) {
        store.update("INSERT INTO teacher_feature_locks(user_id) VALUES(?) ON DUPLICATE KEY UPDATE user_id=user_id",user);
        store.one("SELECT user_id FROM teacher_feature_locks WHERE user_id=? FOR UPDATE",user);
    }
    public long groups(long user) {
        return store.count("SELECT COUNT(*) FROM learning_groups g JOIN group_teachers t ON t.organization_id=g.organization_id AND t.group_id=g.id WHERE t.user_id=? AND g.deleted_at IS NULL",user);
    }
    public long activeAssignments(long user,Instant now,long excluding) {
        return store.count("SELECT COUNT(*) FROM exam_assignments WHERE teacher_id=? AND ends_at>? AND id<>?",user,now,excluding);
    }
    public long credits(long user,String period) {
        return store.count("SELECT COUNT(*) FROM teacher_ai_credits WHERE user_id=? AND quota_period=? AND status IN ('reserved','used')",user,period);
    }
    public long lockedCredits(long user,String period) {
        return store.rows("SELECT job_id FROM teacher_ai_credits WHERE user_id=? AND quota_period=? AND status IN ('reserved','used') FOR UPDATE",user,period).size();
    }
    public Optional<Map<String,Object>> credit(String kind,long job) {
        return store.optional("SELECT * FROM teacher_ai_credits WHERE job_kind=? AND job_id=?",kind,job);
    }
    public void reserve(String kind,long job,long user,String period,Instant now) {
        store.update("INSERT INTO teacher_ai_credits(job_kind,job_id,user_id,quota_period,status,updated_at) VALUES(?,?,?,?,'reserved',?) ON DUPLICATE KEY UPDATE user_id=VALUES(user_id),quota_period=VALUES(quota_period),status='reserved',updated_at=VALUES(updated_at)",kind,job,user,period,now);
    }
    public void settle(String kind,long job,boolean success,Instant now) {
        store.update("UPDATE teacher_ai_credits SET status=?,updated_at=? WHERE job_kind=? AND job_id=? AND status='reserved'",success?"used":"released",now,kind,job);
    }
}
