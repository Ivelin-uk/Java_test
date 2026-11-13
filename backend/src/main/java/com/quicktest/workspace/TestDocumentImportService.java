package com.quicktest.workspace;

import com.quicktest.ai.AiProvider;
import com.quicktest.exception.ApiException;
import com.quicktest.workspace.repository.WorkspaceAiRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

import static com.quicktest.workspace.WorkspaceValues.number;

/** Recognizes a file into an unsaved teacher-owned draft, using one reserved AI credit. */
@Service
public class TestDocumentImportService {
    private static final Logger log = LoggerFactory.getLogger(TestDocumentImportService.class);
    private static final String CREDIT_KIND = "test_document_import";
    private final SourceMaterialService materials;
    private final AiProvider provider;
    private final AssessmentService assessments;
    private final OrganizationService organizations;
    private final TeacherEntitlementService entitlements;
    private final WorkspaceAiRepository aiRepository;
    private final WorkspaceAudit audit;
    private final TransactionTemplate transactions;

    public TestDocumentImportService(SourceMaterialService materials, AiProvider provider, AssessmentService assessments,
                                     OrganizationService organizations, TeacherEntitlementService entitlements,
                                     WorkspaceAiRepository aiRepository, WorkspaceAudit audit, TransactionTemplate transactions) {
        this.materials = materials; this.provider = provider; this.assessments = assessments;
        this.organizations = organizations; this.entitlements = entitlements; this.aiRepository = aiRepository;
        this.audit = audit; this.transactions = transactions;
    }

    public ImportedDraft extract(OrgAccess.Scope scope, SourceMaterialService.Upload upload) {
        if (!scope.roles().contains("TEACHER")) throw WorkspaceError.forbidden();
        SourceMaterialService.TestDocument material = materials.prepareTestDocument(scope, upload);
        long reservation = UUID.randomUUID().getLeastSignificantBits() & Long.MAX_VALUE;
        if (reservation == 0) reservation = 1;
        final long reservationId = reservation;
        reserve(scope, reservationId);
        try {
            AiProvider.ImportedTest result = provider.importTestDocument(new AiProvider.ImportTestDocumentRequest(
                    material.sourceText(), material.fileName(), material.mediaType(), material.fileBase64()));
            ImportedDraft draft = validate(material.fileName(), result);
            settle(scope, reservationId, true, draft.definition().questions().size());
            return draft;
        } catch (RuntimeException failure) {
            try { settle(scope, reservationId, false, 0); }
            catch (RuntimeException settlementFailure) {
                // Never log uploaded content or provider response text.
                log.error("Test document AI credit settlement failed for reservation {}", reservationId);
                failure.addSuppressed(settlementFailure);
            }
            if (failure instanceof ApiException api) throw api;
            throw invalidResult();
        }
    }

    private ImportedDraft validate(String fileName, AiProvider.ImportedTest result) {
        if (result == null || result.definition() == null || result.warnings() == null || result.warnings().size() > 100)
            throw invalidResult();
        var source = result.definition();
        if (source.subject() == null || source.subject().length() > 190 || source.level() == null || source.level().length() > 190
                || source.description() == null || source.description().length() > 20000 || source.instructions() == null
                || source.instructions().length() > 20000 || source.language() == null || source.language().isBlank()
                || source.language().length() > 80 || source.questions() == null
                || source.questions().stream().anyMatch(q -> q == null || q.imageId() != null)) throw invalidResult();
        try {
            assessments.validate(source);
            var questions = source.questions().stream().map(q -> new AssessmentService.Question(q.type(), escape(q.text()),
                    q.difficulty(), q.points(), q.timeSeconds(), q.options() == null ? List.of() : q.options(),
                    q.acceptedAnswers() == null ? List.of() : q.acceptedAnswers(), q.caseInsensitive(), q.collapseWhitespace(),
                    Objects.toString(q.criteria(), ""), Objects.toString(q.explanation(), ""), null, q.matchingPairs())).toList();
            var definition = new AssessmentService.Definition(source.title(), source.description(), source.subject(), source.level(),
                    source.instructions(), source.language(), source.gradingScale(), source.passThreshold(), questions, source.additionalInformation());
            assessments.validate(definition);
            List<String> warnings = new ArrayList<>();
            warnings.add("Прегледай въпросите, верните отговори и точките преди запазване. AI разпознаването може да допусне грешки.");
            for (String warning : result.warnings()) {
                if (warning == null || warning.isBlank() || warning.length() > 1000) throw invalidResult();
                if (!warnings.contains(warning.strip())) warnings.add(warning.strip());
            }
            return new ImportedDraft(fileName, definition, List.copyOf(warnings));
        } catch (WorkspaceError invalid) { throw invalidResult(); }
    }

    private static String escape(String text) {
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    private void reserve(OrgAccess.Scope scope, long id) {
        transactions.executeWithoutResult(status -> {
            organizations.lockQuota(scope.organizationId());
            entitlements.lock(scope);
            if (entitlements.applies(scope)) { entitlements.reserveAi(scope, CREDIT_KIND, id); return; }
            if (!scope.platform()) organizations.requirePaid(scope.organizationId());
            var subscription = organizations.subscription(scope.organizationId());
            if (number(subscription, "ai_used") + number(subscription, "ai_reserved") >= number(subscription, "ai_limit"))
                throw WorkspaceError.conflict("Изчерпана AI квота.");
            aiRepository.reserveQuota(scope.organizationId());
        });
    }

    private void settle(OrgAccess.Scope scope, long id, boolean success, int questionCount) {
        transactions.executeWithoutResult(status -> {
            organizations.lockQuota(scope.organizationId());
            if (entitlements.applies(scope)) {
                entitlements.lockAi(CREDIT_KIND, id);
                if (!entitlements.settleAi(CREDIT_KIND, id, success)) throw new IllegalStateException("AI credit reservation is missing.");
            } else aiRepository.settleQuota(success ? 1 : 0, scope.organizationId());
            if (success) audit.write(scope.organizationId(), scope.userId(), "assessment.document_recognized", null,
                    Map.of("question_count", questionCount));
        });
    }

    private static ApiException invalidResult() {
        return new ApiException(HttpStatus.BAD_GATEWAY, "AI не успя да извлече валиден тест. Използвай по-ясен файл или раздели теста на части до 100 въпроса.");
    }

    public record ImportedDraft(String fileName, AssessmentService.Definition definition, List<String> warnings) {}
}
