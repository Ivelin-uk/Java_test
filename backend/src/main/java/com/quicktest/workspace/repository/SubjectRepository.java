package com.quicktest.workspace.repository;

import com.quicktest.workspace.WorkspaceStore;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Repository
public class SubjectRepository {
    private final WorkspaceStore store;

    public SubjectRepository(WorkspaceStore store) { this.store = store; }

    public List<Map<String, Object>> findByOwner(long owner) {
        return store.rows("SELECT name FROM teacher_subjects WHERE owner_id=? ORDER BY name", owner);
    }

    public void lockOwner(long owner) {
        store.one("SELECT id FROM users WHERE id=? FOR UPDATE", owner);
    }

    public Optional<Map<String, Object>> findByName(long owner, String normalized) {
        return store.optional("SELECT name FROM teacher_subjects WHERE owner_id=? AND normalized_name=?", owner, normalized);
    }

    public long countByOwner(long owner) {
        return store.count("SELECT COUNT(*) FROM teacher_subjects WHERE owner_id=?", owner);
    }

    public long insert(long owner, String name, String normalized, Instant now) {
        return store.insert("INSERT INTO teacher_subjects(owner_id,name,normalized_name,created_at) VALUES(?,?,?,?)", owner, name, normalized, now);
    }
}
