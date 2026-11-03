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
        return store.rows("SELECT name,normalized_name FROM teacher_subjects WHERE owner_id=? ORDER BY name", owner);
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

    public int deleteByOwnerAndName(long owner, String normalized) {
        return store.update("DELETE FROM teacher_subjects WHERE owner_id=? AND normalized_name=?", owner, normalized);
    }

    public int deleteTopicsByOwnerAndSubject(long owner, String normalizedSubject) {
        return store.update("DELETE FROM teacher_subject_topics WHERE owner_id=? AND normalized_subject=?", owner, normalizedSubject);
    }

    public List<Map<String, Object>> findTopicsByOwner(long owner, String subject, String level) {
        return store.rows("SELECT name FROM teacher_subject_topics WHERE owner_id=? AND normalized_subject=? AND (?='' OR level='' OR level=?) ORDER BY name",
                owner, subject, level, level);
    }

    public List<Map<String, Object>> findPersonalTopicNames(long owner, String subject, String level) {
        return store.rows("SELECT DISTINCT name FROM teacher_subject_topics WHERE owner_id=? AND normalized_subject=? AND (?='' OR level='' OR level=?) ORDER BY name",
                owner, subject, level, level);
    }

    public int deleteTopicByOwner(long owner, String subject, String name, String level) {
        return store.update("DELETE FROM teacher_subject_topics WHERE owner_id=? AND normalized_subject=? AND normalized_name=? AND (?='' OR level='' OR level=?)",
                owner, subject, name, level, level);
    }

    public Optional<Map<String, Object>> findTopicByName(long owner, String subject, String name, String level) {
        return store.optional("SELECT id,name FROM teacher_subject_topics WHERE owner_id=? AND normalized_subject=? AND normalized_name=? AND level=?",
                owner, subject, name, level);
    }

    public long insertTopic(long owner, String subjectName, String normalizedSubject, String name, String normalizedName, String level, Instant now) {
        return store.insert("INSERT INTO teacher_subject_topics(owner_id,subject_name,normalized_subject,name,normalized_name,level,created_at) VALUES(?,?,?,?,?,?,?)",
                owner, subjectName, normalizedSubject, name, normalizedName, level, now);
    }

    public void lockCatalog() { store.one("SELECT id FROM subject_catalog_mutex WHERE id=1 FOR UPDATE"); }

    public List<Map<String, Object>> catalogSubjects() {
        return store.rows("SELECT s.id,s.name,COUNT(t.id) topic_count FROM subject_catalog s LEFT JOIN subject_topics t ON t.subject_id=s.id GROUP BY s.id,s.name ORDER BY s.name,s.id");
    }

    public Optional<Map<String, Object>> catalogSubject(long id) {
        return store.optional("SELECT s.id,s.name,COUNT(t.id) topic_count FROM subject_catalog s LEFT JOIN subject_topics t ON t.subject_id=s.id WHERE s.id=? GROUP BY s.id,s.name", id);
    }

    public Optional<Map<String, Object>> catalogSubjectNamed(String normalized) {
        return store.optional("SELECT id,name FROM subject_catalog WHERE normalized_name=?", normalized);
    }

    public long insertCatalogSubject(String name, String normalized, Instant now) {
        return store.insert("INSERT INTO subject_catalog(name,normalized_name,created_at,updated_at) VALUES(?,?,?,?)", name, normalized, now, now);
    }

    public void updateCatalogSubject(long id, String name, String normalized, Instant now) {
        store.update("UPDATE subject_catalog SET name=?,normalized_name=?,updated_at=? WHERE id=?", name, normalized, now, id);
    }

    public void deleteCatalogSubject(long id) { store.update("DELETE FROM subject_catalog WHERE id=?", id); }

    public List<Map<String, Object>> catalogTopics(long subject) {
        return store.rows("SELECT id,subject_id,name,level FROM subject_topics WHERE subject_id=? ORDER BY name,level,id", subject);
    }

    public List<Map<String, Object>> catalogTopicNames(String subject, String level) {
        return store.rows("SELECT t.name FROM subject_topics t JOIN subject_catalog s ON s.id=t.subject_id WHERE s.normalized_name=? AND (?='' OR t.level='' OR t.level=?) ORDER BY t.name,t.id", subject, level, level);
    }

    public Optional<Map<String, Object>> catalogTopic(long subject, long id) {
        return store.optional("SELECT id,subject_id,name,level FROM subject_topics WHERE subject_id=? AND id=?", subject, id);
    }

    public Optional<Map<String, Object>> catalogTopicNamed(long subject, String name, String level) {
        return store.optional("SELECT id,subject_id,name,level FROM subject_topics WHERE subject_id=? AND normalized_name=? AND level=?", subject, name, level);
    }

    public long insertCatalogTopic(long subject, String name, String normalized, String level, Instant now) {
        return store.insert("INSERT INTO subject_topics(subject_id,name,normalized_name,level,created_at,updated_at) VALUES(?,?,?,?,?,?)", subject, name, normalized, level, now, now);
    }

    public void updateCatalogTopic(long subject, long id, String name, String normalized, String level, Instant now) {
        store.update("UPDATE subject_topics SET name=?,normalized_name=?,level=?,updated_at=? WHERE subject_id=? AND id=?", name, normalized, level, now, subject, id);
    }

    public void deleteCatalogTopic(long subject, long id) { store.update("DELETE FROM subject_topics WHERE subject_id=? AND id=?", subject, id); }
}
