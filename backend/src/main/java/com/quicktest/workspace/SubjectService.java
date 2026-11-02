package com.quicktest.workspace;

import com.quicktest.workspace.repository.SubjectRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.text.Collator;
import java.text.Normalizer;
import java.time.Clock;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;

@Service
public class SubjectService {
    private static final List<String> PRESETS = List.of(
            "Български език и литература", "Математика", "Английски език", "Немски език", "Френски език",
            "История и цивилизации", "География и икономика", "Биология и здравно образование",
            "Физика и астрономия", "Химия и опазване на околната среда", "Информатика",
            "Информационни технологии", "Философия", "Музика", "Изобразително изкуство",
            "Технологии и предприемачество", "Физическо възпитание и спорт");
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
        PRESETS.forEach(name -> subjects.put(key(name), new Subject(name, true)));
        repository.findByOwner(scope.userId()).forEach(row -> add(subjects, row.get("name")));
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
        List<String> examples = switch (key(discipline)) {
            case "математика" -> List.of("Естествени числа", "Дроби", "Проценти", "Уравнения", "Геометрични фигури");
            case "български език и литература" -> List.of("Правопис", "Части на речта", "Изречение", "Литературни произведения");
            case "английски език", "немски език", "френски език" -> List.of("Граматика", "Лексика", "Четене с разбиране");
            case "география", "география и икономика" -> List.of("Климат", "Води", "Почви", "Население");
            case "биология", "биология и здравно образование" -> List.of("Клетка", "Човешко тяло", "Екосистеми");
            case "физика", "физика и астрономия" -> List.of("Движение и сили", "Електричество", "Топлина");
            case "химия", "химия и опазване на околната среда" -> List.of("Атоми и молекули", "Химични реакции", "Вещества");
            case "информатика" -> List.of("Алгоритми", "Променливи и типове данни", "Условни конструкции", "Цикли");
            case "информационни технологии" -> List.of("Работа с текст", "Електронни таблици", "Интернет и безопасност");
            case "история", "история и цивилизации" -> List.of("Древни цивилизации", "Средновековие", "Българска история");
            default -> List.of();
        };
        examples.forEach(name -> names.put(key(name), name));
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

    @Transactional
    public Subject create(OrgAccess.Scope scope, String value) {
        requireTeacher(scope);
        String name = clean(value);
        if (name.isEmpty() || name.length() > 190 || name.chars().anyMatch(Character::isISOControl))
            throw WorkspaceError.validation("Дисциплината трябва да съдържа от 1 до 190 символа.");
        String normalized = key(name);
        if (normalized.length() > 190) throw WorkspaceError.validation("Дисциплината трябва да съдържа от 1 до 190 символа.");
        for (String preset : PRESETS) if (key(preset).equals(normalized)) return new Subject(preset, true);
        // Serialize additions for one teacher, including retries and concurrent requests.
        repository.lockOwner(scope.userId());
        var existing = repository.findByName(scope.userId(), normalized);
        if (existing.isPresent()) return new Subject(existing.get().get("name").toString(), false);
        if (repository.countByOwner(scope.userId()) >= 500)
            throw WorkspaceError.conflict("Можете да добавите до 500 собствени дисциплини.");
        long id = repository.insert(scope.userId(), name, normalized, clock.instant());
        audit.write(scope.organizationId(), scope.userId(), "subject.created", id, Map.of("name", name));
        return new Subject(name, false);
    }

    private static void add(Map<String, Subject> subjects, Object value) {
        String name = clean(value == null ? "" : value.toString());
        if (!name.isEmpty()) subjects.putIfAbsent(key(name), new Subject(name, false));
    }

    private static String clean(String name) {
        return Normalizer.normalize(name == null ? "" : name, Normalizer.Form.NFKC).replaceAll("(?U)\\s+", " ").strip();
    }

    private static String key(String name) { return clean(name).toLowerCase(Locale.ROOT); }

    private static void requireTeacher(OrgAccess.Scope scope) {
        if (!scope.roles().contains("TEACHER")) throw WorkspaceError.forbidden();
    }

    public record Subject(String name, boolean preset) {}
}
