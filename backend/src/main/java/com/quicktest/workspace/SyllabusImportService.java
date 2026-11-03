package com.quicktest.workspace;

import com.quicktest.ai.AiProvider;
import com.quicktest.exception.ApiException;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import com.quicktest.workspace.repository.WorkspaceAiRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import static com.quicktest.workspace.WorkspaceValues.number;

@Service
public class SyllabusImportService {
    private static final Logger log = LoggerFactory.getLogger(SyllabusImportService.class);
    private static final int MAX_TOPICS = 300;
    private static final String CREDIT_KIND = "syllabus_import";

    private final SourceMaterialService materials;
    private final AiProvider provider;
    private final SubjectService subjects;
    private final OrganizationService organizations;
    private final TeacherEntitlementService entitlements;
    private final WorkspaceAiRepository aiRepository;
    private final WorkspaceAudit audit;
    private final TransactionTemplate transactions;

    public SyllabusImportService(SourceMaterialService materials, AiProvider provider, SubjectService subjects,
                                 OrganizationService organizations, TeacherEntitlementService entitlements,
                                 WorkspaceAiRepository aiRepository, WorkspaceAudit audit, TransactionTemplate transactions) {
        this.materials = materials;
        this.provider = provider;
        this.subjects = subjects;
        this.organizations = organizations;
        this.entitlements = entitlements;
        this.aiRepository = aiRepository;
        this.audit = audit;
        this.transactions = transactions;
    }

    public SyllabusDraft extract(OrgAccess.Scope scope, SourceMaterialService.Upload upload) {
        requireTeacher(scope);
        if (upload == null || upload.fileName() == null
                || !List.of("pdf", "docx").contains(extension(upload.fileName())))
            throw WorkspaceError.validation("Изберете PDF или DOCX файл с конспект.");

        SourceMaterialService.SyllabusMaterial material = materials.prepareSyllabus(scope, upload);
        long reservationId = reservationId();
        reserve(scope, reservationId);
        try {
            AiProvider.ExtractedSyllabus extracted = provider.extractSyllabus(new AiProvider.ExtractSyllabusRequest(
                    material.sourceText(), material.fileName(), material.fileBase64()));
            SyllabusDraft draft = validateExtracted(material.fileName(), extracted);
            settle(scope, reservationId, true);
            return draft;
        } catch (RuntimeException failure) {
            try {
                settle(scope, reservationId, false);
            } catch (RuntimeException settlementFailure) {
                log.error("Syllabus import AI credit settlement failed for reservation {}", reservationId, settlementFailure);
                failure.addSuppressed(settlementFailure);
            }
            throw failure;
        }
    }

    @Transactional
    public SavedSyllabus confirm(OrgAccess.Scope scope, ConfirmSyllabus request) {
        requireTeacher(scope);
        if (request == null || request.topics() == null || request.topics().isEmpty() || request.topics().size() > MAX_TOPICS)
            throw WorkspaceError.validation("Конспектът трябва да съдържа от 1 до 300 теми.");

        SubjectService.Subject subject = subjects.create(scope, request.subject());
        Map<String, String> unique = new LinkedHashMap<>();
        for (String value : request.topics()) {
            String topic = SubjectNames.name(value);
            unique.putIfAbsent(SubjectNames.key(topic), topic);
        }
        if (unique.isEmpty()) throw WorkspaceError.validation("Добавете поне една тема.");
        List<String> saved = new ArrayList<>();
        for (String topic : unique.values()) saved.add(subjects.createTopic(scope, subject.name(), topic, ""));
        audit.write(scope.organizationId(), scope.userId(), "subject.syllabus_imported", null,
                Map.of("subject", subject.name(), "topic_count", saved.size()));
        return new SavedSyllabus(subject, saved);
    }

    private SyllabusDraft validateExtracted(String fileName, AiProvider.ExtractedSyllabus extracted) {
        if (extracted == null || extracted.topics() == null || extracted.topics().isEmpty() || extracted.topics().size() > MAX_TOPICS)
            throw extractionError();
        try {
            String subject = SubjectNames.name(extracted.subject());
            Map<String, String> unique = new LinkedHashMap<>();
            for (String value : extracted.topics()) {
                String topic = SubjectNames.name(value);
                unique.putIfAbsent(SubjectNames.key(topic), topic);
            }
            if (unique.isEmpty()) throw extractionError();
            return new SyllabusDraft(fileName, subject, List.copyOf(unique.values()));
        } catch (WorkspaceError invalid) {
            throw extractionError();
        }
    }

    private void reserve(OrgAccess.Scope scope, long id) {
        transactions.executeWithoutResult(status -> {
            organizations.lockQuota(scope.organizationId());
            entitlements.lock(scope);
            if (entitlements.applies(scope)) {
                entitlements.reserveAi(scope, CREDIT_KIND, id);
                return;
            }
            if (!scope.platform()) organizations.requirePaid(scope.organizationId());
            var subscription = organizations.subscription(scope.organizationId());
            if (number(subscription, "ai_used") + number(subscription, "ai_reserved") >= number(subscription, "ai_limit"))
                throw WorkspaceError.conflict("Изчерпана AI квота.");
            aiRepository.reserveQuota(scope.organizationId());
        });
    }

    private void settle(OrgAccess.Scope scope, long id, boolean success) {
        transactions.executeWithoutResult(status -> {
            organizations.lockQuota(scope.organizationId());
            if (entitlements.applies(scope)) {
                entitlements.lockAi(CREDIT_KIND, id);
                if (!entitlements.settleAi(CREDIT_KIND, id, success))
                    throw new IllegalStateException("AI credit reservation is missing.");
            } else {
                aiRepository.settleQuota(success ? 1 : 0, scope.organizationId());
            }
        });
    }

    private static ApiException extractionError() {
        return new ApiException(HttpStatus.BAD_GATEWAY, "AI не успя да извлече валидна дисциплина и теми от конспекта.");
    }

    private static String extension(String fileName) {
        int dot = fileName.lastIndexOf('.');
        return dot < 0 ? "" : fileName.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    private static long reservationId() {
        long id = UUID.randomUUID().getLeastSignificantBits() & Long.MAX_VALUE;
        return id == 0 ? 1 : id;
    }

    private static void requireTeacher(OrgAccess.Scope scope) {
        if (!scope.roles().contains("TEACHER")) throw WorkspaceError.forbidden();
    }

    public record SyllabusDraft(String fileName, String subject, List<String> topics) {}
    public record ConfirmSyllabus(@NotBlank @Size(max = 190) String subject,
                                  @NotEmpty @Size(max = MAX_TOPICS) List<@NotBlank @Size(max = 190) String> topics) {}
    public record SavedSyllabus(SubjectService.Subject subject, List<String> topics) {}
}
