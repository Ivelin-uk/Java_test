package com.quicktest.workspace.repository;

import com.quicktest.workspace.WorkspaceStore;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.*;

@Repository
public class AssessmentRepository {
    private final WorkspaceStore store;

    public AssessmentRepository(WorkspaceStore store) {
        this.store = store;
    }

    public List<Map<String, Object>> findVisibleTests(long organizationId, boolean platform, long userId, long userId2) {
        return store.rows("SELECT a.id,a.public_number,a.title,a.status,a.shared,a.owner_id,a.updated_at,a.mobile_allowed,a.definition_json FROM workspace_assessments a WHERE (a.organization_id=? OR ?) AND (a.owner_id=? OR a.shared=TRUE) AND a.status<>'archived' AND NOT EXISTS (SELECT 1 FROM assessment_library_removals r WHERE r.assessment_id=a.id AND r.user_id=?) ORDER BY a.updated_at DESC", organizationId, platform, userId, userId2);
    }

    public Map<String, Object> requireTest(long organizationId, long id) {
        return store.one("SELECT * FROM workspace_assessments WHERE organization_id=? AND id=?", organizationId, id);
    }

    public long insertTest(long organizationId, long userId, String title, String jsonValue,String number, Instant timestamp) {
        return store.insert("INSERT INTO workspace_assessments(organization_id,owner_id,title,definition_json,public_number,updated_at) VALUES(?,?,?,?,?,?)", organizationId, userId, title, jsonValue,number, timestamp);
    }

    public boolean assessmentNumberExists(String number) {
        return store.count("SELECT COUNT(*) FROM workspace_assessments WHERE public_number=?",number)>0;
    }

    public Optional<Map<String,Object>> findImportSource(String number) {
        return store.optional("SELECT a.id,a.organization_id,a.owner_id,v.id version_id,v.definition_json FROM workspace_assessments a JOIN assessment_versions v ON v.organization_id=a.organization_id AND v.assessment_id=a.id JOIN organizations o ON o.id=a.organization_id JOIN memberships m ON m.organization_id=a.organization_id AND m.user_id=a.owner_id JOIN users u ON u.id=a.owner_id WHERE a.public_number=? AND a.status<>'archived' AND o.status='active' AND m.status='active' AND m.roles_json LIKE '%TEACHER%' AND u.active=TRUE AND u.role='TEACHER' ORDER BY v.version_number DESC LIMIT 1",number);
    }

    public Optional<Map<String,Object>> findImportedTest(long org,long user,long source) {
        return store.optional("SELECT a.id FROM assessment_imports i JOIN workspace_assessments a ON a.organization_id=i.organization_id AND a.id=i.assessment_id WHERE i.organization_id=? AND i.user_id=? AND i.source_id=? AND a.owner_id=? AND a.status<>'archived'",org,user,source,user);
    }

    public int deleteImportLink(long org,long user,long source) {
        return store.update("DELETE FROM assessment_imports WHERE organization_id=? AND user_id=? AND source_id=?",org,user,source);
    }

    public int recordImport(long org,long user,long source,long target) {
        return store.update("INSERT INTO assessment_imports(organization_id,user_id,source_id,assessment_id) VALUES(?,?,?,?)",org,user,source,target);
    }

    public int updateDraft(String title, String jsonValue, Instant timestamp, long organizationId, Long id) {
        return store.update("UPDATE workspace_assessments SET title=?,definition_json=?,status='draft',updated_at=? WHERE organization_id=? AND id=?", title, jsonValue, timestamp, organizationId, id);
    }

    public Map<String, Object> lockTest(long organizationId, long id) {
        return store.one("SELECT id FROM workspace_assessments WHERE organization_id=? AND id=? FOR UPDATE", organizationId, id);
    }

    public long nextVersionNumber(long organizationId, long id) {
        return store.count("SELECT COALESCE(MAX(version_number),0)+1 FROM assessment_versions WHERE organization_id=? AND assessment_id=?", organizationId, id);
    }

    public long insertVersion(long organizationId, long id, int next, String title, String jsonValue, Instant timestamp) {
        return store.insert("INSERT INTO assessment_versions(organization_id,assessment_id,version_number,title,definition_json,published_at) VALUES(?,?,?,?,?,?)", organizationId, id, next, title, jsonValue, timestamp);
    }

    public int markPublished(long organizationId, long id) {
        return store.update("UPDATE workspace_assessments SET status='published' WHERE organization_id=? AND id=?", organizationId, id);
    }

    public Map<String, Object> requireVersion(long organizationId, long version) {
        return store.one("SELECT id,assessment_id,version_number,title,published_at FROM assessment_versions WHERE organization_id=? AND id=?", organizationId, version);
    }

    public List<Map<String, Object>> findVersions(long organizationId, long id) {
        return store.rows("SELECT id,version_number,title,published_at FROM assessment_versions WHERE organization_id=? AND assessment_id=? ORDER BY version_number DESC", organizationId, id);
    }

    public int removeFromLibrary(long organizationId, long id, long userId, Instant timestamp) {
        return store.update("INSERT INTO assessment_library_removals(organization_id,assessment_id,user_id,removed_at) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE removed_at=VALUES(removed_at)", organizationId, id, userId, timestamp);
    }

    public long countVersions(long organizationId, long id) {
        return store.count("SELECT COUNT(*) FROM assessment_versions WHERE organization_id=? AND assessment_id=?", organizationId, id);
    }

    public int deleteTest(long organizationId, long id) {
        return store.update("DELETE FROM workspace_assessments WHERE organization_id=? AND id=?", organizationId, id);
    }

    public int archiveTest(long organizationId, long id) {
        return store.update("UPDATE workspace_assessments SET status='archived' WHERE organization_id=? AND id=?", organizationId, id);
    }

    public int updateSharing(boolean shared, long organizationId, long id) {
        return store.update("UPDATE workspace_assessments SET shared=? WHERE organization_id=? AND id=?", shared, organizationId, id);
    }

    public int updateMobileMode(long organizationId, long id, boolean mobileAllowed) {
        return store.update("UPDATE workspace_assessments SET mobile_allowed=? WHERE organization_id=? AND id=?", mobileAllowed, organizationId, id);
    }

    public int updateAssessmentAssignmentsMobileMode(long organizationId, long assessmentId, boolean mobileAllowed) {
        return store.update("UPDATE exam_assignments SET mobile_allowed=? WHERE organization_id=? AND version_id IN (SELECT id FROM assessment_versions WHERE organization_id=? AND assessment_id=?)", mobileAllowed, organizationId, organizationId, assessmentId);
    }

    public long countAssessmentAssignmentsWithDifferentMobileMode(long organizationId, long assessmentId, boolean mobileAllowed) {
        return store.count("SELECT COUNT(*) FROM exam_assignments WHERE organization_id=? AND version_id IN (SELECT id FROM assessment_versions WHERE organization_id=? AND assessment_id=?) AND (mobile_allowed IS NULL OR mobile_allowed<>?)", organizationId, organizationId, assessmentId, mobileAllowed);
    }
}
