package com.quicktest.workspace;

import com.quicktest.admin.AdminAudit;
import com.quicktest.admin.AdminAuditRepository;
import com.quicktest.auth.AppUser;
import com.quicktest.auth.AppUserRepository;
import com.quicktest.auth.Role;
import com.quicktest.workspace.repository.SubjectRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.List;
import java.util.Map;

import static com.quicktest.workspace.WorkspaceValues.number;
import static com.quicktest.workspace.WorkspaceValues.string;

@Service
public class SubjectCatalogAdminService {
    private final SubjectRepository repository;
    private final AppUserRepository users;
    private final AdminAuditRepository audits;
    private final Clock clock;

    public SubjectCatalogAdminService(SubjectRepository repository, AppUserRepository users, AdminAuditRepository audits, Clock clock) {
        this.repository = repository; this.users = users; this.audits = audits; this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<CatalogSubject> subjects(AppUser actor) {
        requireAdmin(actor);
        return repository.catalogSubjects().stream().map(this::subject).toList();
    }

    @Transactional
    public CatalogSubject createSubject(AppUser actor, String value) {
        requireAdmin(actor);
        String name = SubjectNames.name(value), key = SubjectNames.key(name);
        // All catalog writers take the same lock before subject/topic rows. This also serializes normalized retries.
        repository.lockCatalog();
        var existing = repository.catalogSubjectNamed(key);
        if (existing.isPresent()) return requireSubject(number(existing.get(), "id"));
        long id = repository.insertCatalogSubject(name, key, clock.instant());
        audit(actor, "SUBJECT_CREATED", "Дисциплина #" + id + ": " + name);
        return requireSubject(id);
    }

    @Transactional
    public CatalogSubject updateSubject(AppUser actor, long id, String value) {
        requireAdmin(actor);
        String name = SubjectNames.name(value), key = SubjectNames.key(name);
        repository.lockCatalog();
        CatalogSubject previous = requireSubject(id);
        repository.catalogSubjectNamed(key).filter(row -> number(row, "id") != id).ifPresent(row -> {
            throw WorkspaceError.conflict("Вече има дисциплина с това име.");
        });
        if (!previous.name().equals(name)) {
            repository.updateCatalogSubject(id, name, key, clock.instant());
            audit(actor, "SUBJECT_UPDATED", "Дисциплина #" + id + ": " + previous.name() + " → " + name);
        }
        return requireSubject(id);
    }

    @Transactional
    public void deleteSubject(AppUser actor, long id) {
        requireAdmin(actor);
        repository.lockCatalog();
        CatalogSubject previous = requireSubject(id);
        repository.deleteCatalogSubject(id);
        audit(actor, "SUBJECT_DELETED", "Дисциплина #" + id + ": " + previous.name() + "; премахнати теми: " + previous.topicCount());
    }

    @Transactional(readOnly = true)
    public List<CatalogTopic> topics(AppUser actor, long subject) {
        requireAdmin(actor); requireSubject(subject);
        return repository.catalogTopics(subject).stream().map(this::topic).toList();
    }

    @Transactional
    public CatalogTopic createTopic(AppUser actor, long subject, String value, String grade) {
        requireAdmin(actor);
        String name = SubjectNames.name(value), key = SubjectNames.key(name), level = SubjectNames.level(grade);
        repository.lockCatalog(); requireSubject(subject);
        var existing = repository.catalogTopicNamed(subject, key, level);
        if (existing.isPresent()) return topic(existing.get());
        long id = repository.insertCatalogTopic(subject, name, key, level, clock.instant());
        audit(actor, "TOPIC_CREATED", "Тема #" + id + " към дисциплина #" + subject + ": " + name + "; клас: " + level);
        return requireTopic(subject, id);
    }

    @Transactional
    public CatalogTopic updateTopic(AppUser actor, long subject, long id, String value, String grade) {
        requireAdmin(actor);
        String name = SubjectNames.name(value), key = SubjectNames.key(name), level = SubjectNames.level(grade);
        repository.lockCatalog(); requireSubject(subject);
        CatalogTopic previous = requireTopic(subject, id);
        repository.catalogTopicNamed(subject, key, level).filter(row -> number(row, "id") != id).ifPresent(row -> {
            throw WorkspaceError.conflict("Вече има тема с това име и клас към дисциплината.");
        });
        if (!previous.name().equals(name) || !previous.level().equals(level)) {
            repository.updateCatalogTopic(subject, id, name, key, level, clock.instant());
            audit(actor, "TOPIC_UPDATED", "Тема #" + id + " към дисциплина #" + subject + ": " + previous.name() + " → " + name + "; клас: " + previous.level() + " → " + level);
        }
        return requireTopic(subject, id);
    }

    @Transactional
    public void deleteTopic(AppUser actor, long subject, long id) {
        requireAdmin(actor);
        repository.lockCatalog(); requireSubject(subject);
        CatalogTopic previous = requireTopic(subject, id);
        repository.deleteCatalogTopic(subject, id);
        audit(actor, "TOPIC_DELETED", "Тема #" + id + " към дисциплина #" + subject + ": " + previous.name() + "; клас: " + previous.level());
    }

    private void requireAdmin(AppUser actor) {
        AppUser current = actor == null || actor.getId() == null ? null : users.findById(actor.getId()).orElse(null);
        if (current == null || !current.isActive() || current.getRole() != Role.ADMIN || current.isRoleSelectionRequired())
            throw WorkspaceError.forbidden();
    }

    private CatalogSubject requireSubject(long id) { return subject(repository.catalogSubject(id).orElseThrow(WorkspaceError::notFound)); }
    private CatalogTopic requireTopic(long subject, long id) { return topic(repository.catalogTopic(subject, id).orElseThrow(WorkspaceError::notFound)); }
    private CatalogSubject subject(Map<String, Object> row) { return new CatalogSubject(number(row, "id"), string(row, "name"), number(row, "topic_count")); }
    private CatalogTopic topic(Map<String, Object> row) { return new CatalogTopic(number(row, "id"), number(row, "subject_id"), string(row, "name"), string(row, "level")); }
    private void audit(AppUser actor, String action, String details) {
        AdminAudit audit = new AdminAudit(); audit.setActor(actor); audit.setAction(action); audit.setDetails(details); audit.setCreatedAt(clock.instant()); audits.save(audit);
    }

    public record CatalogSubject(long id, String name, long topicCount) {}
    public record CatalogTopic(long id, long subjectId, String name, String level) {}
}
