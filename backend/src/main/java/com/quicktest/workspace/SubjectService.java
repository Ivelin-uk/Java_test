package com.quicktest.workspace;

import com.quicktest.workspace.repository.SubjectRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.text.Collator;
import java.time.Clock;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;

import static com.quicktest.workspace.SubjectNames.clean;
import static com.quicktest.workspace.SubjectNames.key;

@Service
public class SubjectService {
    private final SubjectRepository repository;
    private final AssessmentService assessments;
    private final WorkspaceAudit audit;
    private final Clock clock;

    public SubjectService(SubjectRepository repository, AssessmentService assessments, WorkspaceAudit audit, Clock clock) {
        this.repository = repository;
        this.assessments = assessments;
        this.audit = audit;
        this.clock = clock;
    }

    public List<Subject> list(OrgAccess.Scope scope) {
        requireTeacher(scope);
        Map<String, Subject> subjects = new LinkedHashMap<>();
        repository.catalogSubjects().forEach(row -> {
            String name = row.get("name").toString();
            subjects.put(key(name), new Subject(name, true, false));
        });
        repository.findByOwner(scope.userId()).forEach(row -> {
            String name = row.get("name").toString();
            subjects.putIfAbsent(key(name), new Subject(name, false, true));
        });
        // Existing and imported tests keep their subject names without rewriting their definitions.
        assessments.list(scope).forEach(row -> add(subjects, row.get("subject")));
        Collator order = Collator.getInstance(Locale.forLanguageTag("bg"));
        return subjects.values().stream().sorted((a, b) -> order.compare(a.name(), b.name())).toList();
    }

    public List<String> topics(OrgAccess.Scope scope, String subject, String level) {
        requireTeacher(scope);
        String discipline = clean(subject), grade = clean(level);
        if (discipline.isEmpty() || discipline.length() > 190 || grade.length() > 190)
            throw WorkspaceError.validation("Изберете дисциплина и валиден клас.");
        Map<String, String> names = new LinkedHashMap<>();
        repository.catalogTopicNames(key(discipline), grade).forEach(row -> {
            String name = row.get("name").toString();
            names.putIfAbsent(key(name), name);
        });
        repository.findTopicsByOwner(scope.userId(), key(discipline), grade).forEach(row -> {
            String name = row.get("name").toString();
            names.putIfAbsent(key(name), name);
        });
        assessments.list(scope).forEach(test -> {
            String existingSubject = clean(Objects.toString(test.get("subject"), ""));
            String existingLevel = clean(Objects.toString(test.get("level"), ""));
            if (key(existingSubject).equals(key(discipline)) && (grade.isEmpty() || existingLevel.isEmpty() || key(existingLevel).equals(key(grade)))) {
                String title = clean(Objects.toString(test.get("title"), ""));
                if (!title.isEmpty()) names.putIfAbsent(key(title), title);
            }
        });
        Collator order = Collator.getInstance(Locale.forLanguageTag("bg"));
        return names.values().stream().sorted(order::compare).toList();
    }

    public List<String> personalTopics(OrgAccess.Scope scope, String subject, String level) {
        requireTeacher(scope);
        String discipline = clean(subject), grade = SubjectNames.level(level);
        if (discipline.isEmpty() || discipline.length() > 190 || discipline.chars().anyMatch(Character::isISOControl))
            throw WorkspaceError.validation("Изберете валидна дисциплина.");
        Collator order = Collator.getInstance(Locale.forLanguageTag("bg"));
        return repository.findPersonalTopicNames(scope.userId(), key(discipline), grade).stream()
                .map(row -> row.get("name").toString()).sorted(order::compare).toList();
    }

    @Transactional
    public String createTopic(OrgAccess.Scope scope, String subject, String value, String level) {
        requireTeacher(scope);
        String discipline = clean(subject), name = clean(value), grade = SubjectNames.level(level);
        if (discipline.isEmpty() || discipline.length() > 190 || key(discipline).length() > 190
                || discipline.chars().anyMatch(Character::isISOControl))
            throw WorkspaceError.validation("Изберете валидна дисциплина.");
        if (name.isEmpty() || name.length() > 190 || name.chars().anyMatch(Character::isISOControl))
            throw WorkspaceError.validation("Темата трябва да съдържа от 1 до 190 символа.");
        String normalizedSubject = key(discipline), normalizedName = key(name);
        if (normalizedName.length() > 190)
            throw WorkspaceError.validation("Темата трябва да съдържа от 1 до 190 символа.");
        repository.lockOwner(scope.userId());
        var existing = repository.findTopicByName(scope.userId(), normalizedSubject, normalizedName, grade);
        if (existing.isPresent()) return existing.get().get("name").toString();
        long id = repository.insertTopic(scope.userId(), discipline, normalizedSubject, name, normalizedName, grade, clock.instant());
        audit.write(scope.organizationId(), scope.userId(), "topic.created", id,
                Map.of("subject", discipline, "name", name, "level", grade));
        return name;
    }

    @Transactional
    public Subject create(OrgAccess.Scope scope, String value) {
        requireTeacher(scope);
        String name = clean(value);
        if (name.isEmpty() || name.length() > 190 || name.chars().anyMatch(Character::isISOControl))
            throw WorkspaceError.validation("Дисциплината трябва да съдържа от 1 до 190 символа.");
        String normalized = key(name);
        if (normalized.length() > 190) throw WorkspaceError.validation("Дисциплината трябва да съдържа от 1 до 190 символа.");
        var common = repository.catalogSubjectNamed(normalized);
        if (common.isPresent()) return new Subject(common.get().get("name").toString(), true, false);
        // Serialize additions for one teacher, including retries and concurrent requests.
        repository.lockOwner(scope.userId());
        var existing = repository.findByName(scope.userId(), normalized);
        if (existing.isPresent()) return new Subject(existing.get().get("name").toString(), false, true);
        if (repository.countByOwner(scope.userId()) >= 500)
            throw WorkspaceError.conflict("Можете да добавите до 500 собствени дисциплини.");
        long id = repository.insert(scope.userId(), name, normalized, clock.instant());
        audit.write(scope.organizationId(), scope.userId(), "subject.created", id, Map.of("name", name));
        return new Subject(name, false, true);
    }

    @Transactional
    public void delete(OrgAccess.Scope scope, String value) {
        requireTeacher(scope);
        String name = clean(value);
        if (name.isEmpty() || name.length() > 190 || name.chars().anyMatch(Character::isISOControl))
            throw WorkspaceError.validation("Изберете валидна лична дисциплина.");
        String normalized = key(name);
        repository.lockOwner(scope.userId());
        var existing = repository.findByName(scope.userId(), normalized);
        if (existing.isEmpty()) throw WorkspaceError.notFound();
        repository.deleteTopicsByOwnerAndSubject(scope.userId(), normalized);
        repository.deleteByOwnerAndName(scope.userId(), normalized);
        audit.write(scope.organizationId(), scope.userId(), "subject.deleted", null,
                Map.of("name", existing.get().get("name").toString()));
    }

    @Transactional
    public void deleteTopic(OrgAccess.Scope scope, String subject, String value, String level) {
        requireTeacher(scope);
        String discipline = clean(subject), name = clean(value), grade = SubjectNames.level(level);
        if (discipline.isEmpty() || discipline.length() > 190 || discipline.chars().anyMatch(Character::isISOControl))
            throw WorkspaceError.validation("Изберете валидна дисциплина.");
        if (name.isEmpty() || name.length() > 190 || name.chars().anyMatch(Character::isISOControl))
            throw WorkspaceError.validation("Изберете валидна лична тема.");
        repository.lockOwner(scope.userId());
        int deleted = repository.deleteTopicByOwner(scope.userId(), key(discipline), key(name), grade);
        if (deleted == 0) throw WorkspaceError.notFound();
        audit.write(scope.organizationId(), scope.userId(), "topic.deleted", null,
                Map.of("subject", discipline, "name", name, "level", grade));
    }

    private static void add(Map<String, Subject> subjects, Object value) {
        String name = clean(value == null ? "" : value.toString());
        if (!name.isEmpty()) subjects.putIfAbsent(key(name), new Subject(name, false, false));
    }

    private static void requireTeacher(OrgAccess.Scope scope) {
        if (!scope.roles().contains("TEACHER")) throw WorkspaceError.forbidden();
    }

    public record Subject(String name, boolean preset, boolean personal) {}
}
