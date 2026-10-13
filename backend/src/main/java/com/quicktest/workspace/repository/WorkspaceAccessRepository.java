package com.quicktest.workspace.repository;

import com.quicktest.workspace.WorkspaceStore;
import org.springframework.stereotype.Repository;

import java.util.*;

@Repository
public class WorkspaceAccessRepository {
    private final WorkspaceStore store;

    public WorkspaceAccessRepository(WorkspaceStore store) {
        this.store = store;
    }

    public Map<String, Object> requireResourceWorkspace(String resource, long id) {
        String table = switch (resource) {
            case "tests" -> "workspace_assessments";
            case "assignments" -> "exam_assignments";
            case "groups" -> "learning_groups";
            case "question-bank" -> "question_bank_items";
            case "files" -> "private_images";
            case "ai/test-generations" -> "workspace_ai_jobs";
            case "attempts", "results", "grading" -> "exam_attempts";
            default -> throw new IllegalArgumentException("Unknown workspace resource");
        };
        return store.one("SELECT organization_id FROM " + table + " WHERE id=?", id);
    }

    public Optional<Map<String, Object>> findActiveMembership(long id, Long userId) {
        return store.optional("SELECT m.*,o.name,o.status organization_status FROM memberships m JOIN organizations o ON o.id=m.organization_id WHERE m.organization_id=? AND m.user_id=? AND m.status='active' AND o.status='active'", id, userId);
    }

    public Map<String, Object> requireVersionWorkspace(long version) {
        return store.one("SELECT organization_id FROM assessment_versions WHERE id=?", version);
    }
}
