package com.quicktest.workspace.repository;

import com.quicktest.workspace.WorkspaceStore;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.*;

@Repository
public class PrivateImageRepository {
    private final WorkspaceStore store;

    public PrivateImageRepository(WorkspaceStore store) {
        this.store = store;
    }

    public byte[] requireContent(long organizationId, long id) {
        return store.bytes("SELECT content FROM private_images WHERE organization_id=? AND id=?", organizationId, id);
    }

    public long storageUsed(long organizationId) {
        return store.count("SELECT COALESCE(SUM(byte_size),0) FROM private_images WHERE organization_id=?", organizationId);
    }

    public Map<String,Object> requireCopyMetadata(long id) {
        return store.one("SELECT id,organization_id,purpose,mime_type,byte_size,width,height FROM private_images WHERE id=?",id);
    }

    public long insertImage(long organizationId, long userId, String purpose, String value, int value2, int width, int height, byte[] canonical, Instant timestamp) {
        return store.insert("INSERT INTO private_images(organization_id,owner_id,purpose,mime_type,byte_size,width,height,content,created_at) VALUES(?,?,?,?,?,?,?,?,?)", organizationId, userId, purpose, value, value2, width, height, canonical, timestamp);
    }

    public int setOrganizationLogo(long id, long organizationId) {
        return store.update("UPDATE organizations SET logo_id=? WHERE id=?", id, organizationId);
    }

    public Map<String, Object> requireImageMetadata(long organizationId, boolean platform, Long id) {
        return store.one("SELECT id,owner_id,purpose FROM private_images WHERE (organization_id=? OR ?) AND id=?", organizationId, platform, id);
    }

    public List<Map<String, Object>> findSharedTestDefinitions(long organizationId, boolean platform) {
        return store.rows("SELECT definition_json FROM workspace_assessments WHERE (organization_id=? OR ?) AND shared=TRUE", organizationId, platform);
    }

    public List<Map<String, Object>> findSharedBankDefinitions(long organizationId, boolean platform) {
        return store.rows("SELECT definition_json FROM question_bank_items WHERE (organization_id=? OR ?) AND shared=TRUE", organizationId, platform);
    }

    public Map<String, Object> requireDownloadMetadata(long organizationId, long id) {
        return store.one("SELECT id,owner_id,purpose,mime_type FROM private_images WHERE organization_id=? AND id=?", organizationId, id);
    }

    public Map<String, Object> requireAttemptAccess(long organizationId, boolean platform, Long attempt, long userId) {
        return store.one("SELECT a.*,x.ends_at,x.answers_after_deadline FROM exam_attempts a JOIN exam_assignments x ON x.organization_id=a.organization_id AND x.id=a.assignment_id WHERE (a.organization_id=? OR ?) AND a.id=? AND a.student_id=?", organizationId, platform, attempt, userId);
    }

    public List<Map<String, Object>> findAttemptQuestions(long organizationId, Long attempt) {
        return store.rows("SELECT definition_json,status,position_index,deadline_at FROM attempt_questions WHERE organization_id=? AND attempt_id=?", organizationId, attempt);
    }
}
