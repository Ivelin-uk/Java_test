package com.quicktest.workspace.repository;

import com.quicktest.workspace.WorkspaceStore;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.*;

@Repository
public class QuestionBankRepository {
    private final WorkspaceStore store;

    public QuestionBankRepository(WorkspaceStore store) {
        this.store = store;
    }

    public List<Map<String, Object>> findVisibleItems(long organizationId, boolean platform, long userId) {
        return store.rows("SELECT * FROM question_bank_items WHERE (organization_id=? OR ?) AND (owner_id=? OR shared=TRUE) ORDER BY id DESC", organizationId, platform, userId);
    }

    public long insertItem(long organizationId, long userId, String subject, boolean shared, String jsonValue, Instant timestamp) {
        return store.insert("INSERT INTO question_bank_items(organization_id,owner_id,subject,shared,definition_json,created_at) VALUES(?,?,?,?,?,?)", organizationId, userId, subject, shared, jsonValue, timestamp);
    }

    public Map<String, Object> requireItem(long organizationId, long id) {
        return store.one("SELECT * FROM question_bank_items WHERE organization_id=? AND id=?", organizationId, id);
    }

    public Map<String, Object> requireOwner(long organizationId, long id) {
        return store.one("SELECT owner_id FROM question_bank_items WHERE organization_id=? AND id=?", organizationId, id);
    }

    public int deleteItem(long organizationId, long id) {
        return store.update("DELETE FROM question_bank_items WHERE organization_id=? AND id=?", organizationId, id);
    }
}
