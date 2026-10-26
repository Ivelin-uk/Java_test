package com.quicktest.workspace;

import com.quicktest.workspace.repository.AiGradingRepository;

import com.quicktest.ai.AiProvider;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.Clock;
import java.util.*;

import static com.quicktest.workspace.WorkspaceValues.*;

@Service
public class AiGradingService {
    private final WorkspaceJson json;
    private static final Logger log = LoggerFactory.getLogger(AiGradingService.class);
    private final AiGradingRepository repository;
    private final AiProvider provider;
    private final OrganizationService organizations;
    private final AssignmentService assignments;
    private final GradingService grading;
    private final WorkspaceCrypto crypto;
    private final WorkspaceAudit audit;
    private final TransactionTemplate transactions;
    private final Clock clock;
    private final boolean workers;
    private final TeacherEntitlementService entitlements;

    public AiGradingService(AiGradingRepository repository,WorkspaceJson json, AiProvider provider, OrganizationService organizations,
                            AssignmentService assignments, GradingService grading, WorkspaceCrypto crypto,
                            WorkspaceAudit audit, TransactionTemplate transactions, Clock clock,TeacherEntitlementService entitlements,
                            @Value("${app.workspace.workers:true}") boolean workers) {
        this.repository = repository;this.json=json; this.provider = provider; this.organizations = organizations; this.assignments = assignments;
        this.grading = grading; this.crypto = crypto; this.audit = audit; this.transactions = transactions;
        this.clock = clock; this.workers = workers;this.entitlements=entitlements;
    }

    @Transactional
    public Map<String, Object> enqueue(OrgAccess.Scope scope, long attemptId, Request request, boolean retry) {
        if (request.requestKey() == null || !request.requestKey().matches("[A-Za-z0-9_-]{8,80}"))
            throw WorkspaceError.validation("Невалиден ключ за AI проверка.");
        organizations.lockQuota(scope.organizationId());
        entitlements.lock(scope);
        var attempt = authorizedAttempt(scope, attemptId, true);
        var existing = repository.findJobByAttemptForUpdate(scope.organizationId(), attemptId);
        if (existing.isPresent() && (!retry || !string(existing.get(), "status").equals("failed")
                || string(existing.get(), "request_key").equals(request.requestKey()))) return safe(existing.get());
        if (!string(attempt, "status").equals("pending_review")) throw WorkspaceError.conflict("AI проверка е достъпна само за опити, чакащи проверка.");
        if (retry && (existing.isEmpty() || number(existing.get(), "attempts") >= 3)) throw WorkspaceError.conflict("Не може да се повтори тази AI проверка. Използвайте ръчна проверка.");
        var questions = questions(scope.organizationId(), attemptId);
        var targets = targets(questions);
        boolean reserved = !targets.isEmpty();
        if (reserved && !entitlements.applies(scope)) {
            if (!scope.platform()) organizations.requirePaid(scope.organizationId());
            var subscription = organizations.subscription(scope.organizationId());
            if (number(subscription, "ai_used") + number(subscription, "ai_reserved") >= number(subscription, "ai_limit"))
                throw WorkspaceError.conflict("Изчерпана AI квота. Ръчната проверка остава достъпна.");
            repository.reserveQuota(scope.organizationId());
        }
        long id;
        if (existing.isPresent()) {
            id = number(existing.get(), "id");
            repository.requeueJob(scope.userId(), scope.platform(), request.requestKey(), fingerprint(questions), reserved, clock.instant(), scope.organizationId(), id);
        } else {
            id = repository.insertJob(scope.organizationId(), attemptId, scope.userId(), scope.platform(), request.requestKey(), fingerprint(questions), reserved, clock.instant(), clock.instant());
        }
        if(reserved && entitlements.applies(scope)) entitlements.reserveAi(scope,"grading",id);
        audit.write(scope.organizationId(), scope.userId(), "grading.ai_queued", attemptId, Map.of("job", id));
        return safe(repository.requireJob(id));
    }

    private Map<String, Object> authorizedAttempt(OrgAccess.Scope scope, long id, boolean lock) {
        if (!scope.roles().contains("TEACHER")) throw WorkspaceError.forbidden();
        if (scope.platform()) repository.requireActiveTeacher(scope.userId());
        else {
            organizations.requireActiveMember(scope.organizationId(), scope.userId(), "TEACHER");
            repository.requireActiveOrganization(scope.organizationId());
        }
        var attempt = repository.findAttempt(scope.organizationId(), id, lock);
        assignments.teacherAccess(scope, number(attempt, "assignment_id"), false);
        return attempt;
    }

    private List<Map<String, Object>> questions(long org, long attempt) {
        return repository.findQuestions(org, attempt);
    }

    private String fingerprint(List<Map<String, Object>> questions) { return crypto.hash(json.write(questions)); }

    private List<AiProvider.GradingQuestion> targets(List<Map<String, Object>> questions) {
        var result = new ArrayList<AiProvider.GradingQuestion>();
        for (var row : questions) {
            if (flag(row, "reviewed") && row.get("final_points") != null) continue;
            if (!string(row, "status").equals("answered") || row.get("answer_json") == null) continue;
            var answer = json.parse(row.get("answer_json"), AttemptService.Answer.class);
            if (answer.text() == null || answer.text().isBlank()) continue;
            var snapshot = json.object(row.get("definition_json"));
            var question = json.parse(json.write(snapshot.get("question")), AssessmentService.Question.class);
            if (!Set.of("SHORT_ANSWER", "OPEN_ANSWER").contains(question.type())) throw WorkspaceError.conflict("Този отговор изисква ръчна проверка.");
            if (question.imageId() != null) throw WorkspaceError.conflict("Текстовите въпроси с изображение изискват ръчна проверка.");
            result.add(new AiProvider.GradingQuestion(number(row, "id"), question.type(), question.text(), decimal(row, "maximum_points"),
                    Objects.toString(question.criteria(), ""), question.acceptedAnswers() == null ? List.of() : question.acceptedAnswers(),
                    Objects.toString(question.explanation(), ""), answer.text()));
        }
        return result;
    }

    @Scheduled(fixedDelay = 1000)
    public void process() {
        if (!workers) return;
        for (var stale : repository.findStaleJobs(clock.instant().minusSeconds(600)))
            fail(number(stale, "organization_id"), number(stale, "id"), number(stale, "attempts"), "Прекъсната AI проверка. Повторете или проверете ръчно.");
        enqueueAutomatic();
        var job = transactions.execute(tx -> {
            var next = repository.findNextJobForUpdate();
            if (next.isEmpty()) return null;
            var row = next.get();
            repository.markRunning(clock.instant(), number(row, "id"));
            return row;
        });
        if (job == null) return;
        long org = number(job, "organization_id"), id = number(job, "id"), lease = number(job, "attempts") + 1;
        var scope = new OrgAccess.Scope(org, number(job, "user_id"), Set.of("TEACHER"), flag(job, "platform_scope"));
        try {
            var attempt = authorizedAttempt(scope, number(job, "attempt_id"), false);
            var questions = questions(org, number(job, "attempt_id"));
            checkSnapshot(job, attempt, questions);
            var targets = targets(questions);
            var assignment = assignments.teacherAccess(scope, number(attempt, "assignment_id"), false);
            var definition = json.parse(assignment.get("definition_json"), AssessmentService.Definition.class);
            // Only submitted text is sent, without student identity, drafts or session secrets.
            var result = targets.isEmpty() ? new AiProvider.GradedAnswers(List.of(), "automatic", 0, 0)
                    : provider.gradeAnswers(new AiProvider.GradeAnswersRequest(definition.language(), targets));
            validate(result, targets);
            transactions.executeWithoutResult(tx -> publish(scope, job, lease, result));
        } catch (Exception error) {
            log.warn("AI grading job {} failed ({})", id, error.getClass().getSimpleName());
            fail(org, id, lease, failureMessage(error));
        }
    }

    // Discover committed submissions durably, including timeout/submission while
    // the worker was offline. Submission never waits on AI or consumes quota.
    private void enqueueAutomatic() {
        for(var candidate:repository.findAutomaticCandidates()) {
            long org=number(candidate,"organization_id"),attemptId=number(candidate,"id");
            try {
                transactions.executeWithoutResult(tx->{
                    organizations.lockQuota(org);
                    var current=repository.findAutomaticCandidate(org,attemptId);
                    if(current.isEmpty() || !sameAutomaticActor(candidate,current.get())) return;
                    var scope=new OrgAccess.Scope(org,number(candidate,"user_id"),Set.of("TEACHER"),flag(candidate,"platform_scope"));
                    entitlements.requireAutomaticGrading(scope);
                    // The template owns the transaction, including enqueue's quota reservation.
                    enqueue(scope,attemptId,new Request("auto-grading-"+attemptId),false);
                });
            } catch(Exception error) {
                log.warn("Automatic AI grading for attempt {} could not be queued ({})",attemptId,error.getClass().getSimpleName());
                recordAutomaticFailure(candidate,failureMessage(error));
            }
        }
    }

    private boolean sameAutomaticActor(Map<String,Object> first,Map<String,Object> second) {
        return number(first,"user_id")==number(second,"user_id") && flag(first,"platform_scope")==flag(second,"platform_scope");
    }

    private void recordAutomaticFailure(Map<String,Object> candidate,String message) {
        long org=number(candidate,"organization_id"),attemptId=number(candidate,"id");
        try {
            transactions.executeWithoutResult(tx->{
                organizations.lockQuota(org);
                var current=repository.findAutomaticCandidate(org,attemptId);
                if(current.isEmpty() || !sameAutomaticActor(candidate,current.get())) return;
                var attempt=repository.findAttempt(org,attemptId,true);
                if(!string(attempt,"status").equals("pending_review") || repository.findJobByAttemptForUpdate(org,attemptId).isPresent()) return;
                long id=repository.insertJob(org,attemptId,number(candidate,"user_id"),flag(candidate,"platform_scope"),"auto-grading-"+attemptId,fingerprint(questions(org,attemptId)),false,clock.instant(),clock.instant());
                repository.markFailed(message.substring(0,Math.min(message.length(),500)),clock.instant(),org,id);
                audit.write(org,number(candidate,"user_id"),"grading.ai_auto_failed",attemptId,Map.of("job",id));
            });
        } catch(Exception error) {
            log.warn("Automatic AI grading failure for attempt {} could not be recorded ({})",attemptId,error.getClass().getSimpleName());
        }
    }

    private String failureMessage(Exception error) {
        return error instanceof ResponseStatusException response && response.getReason()!=null ? response.getReason()
                : "AI проверката не успя. Резултатът не е публикуван. Повторете или проверете ръчно.";
    }

    private void checkSnapshot(Map<String, Object> job, Map<String, Object> attempt, List<Map<String, Object>> questions) {
        if (!string(attempt, "status").equals("pending_review") || !fingerprint(questions).equals(string(job, "snapshot_hash")))
            throw WorkspaceError.conflict("Опитът е променен след старта на AI проверката. Ръчните промени са запазени.");
    }

    private void validate(AiProvider.GradedAnswers result, List<AiProvider.GradingQuestion> targets) {
        if (result == null || result.grades() == null || result.grades().size() != targets.size()) throw invalid();
        var expected = new HashMap<Long, BigDecimal>();
        targets.forEach(q -> expected.put(q.id(), q.maximumPoints()));
        for (var grade : result.grades()) {
            if (grade == null) throw invalid();
            var maximum = expected.remove(grade.questionId());
            if (maximum == null || grade.points() == null || grade.points().compareTo(BigDecimal.ZERO) < 0
                    || grade.points().compareTo(maximum) > 0 || grade.points().scale() > 4
                    || grade.comment() == null || grade.comment().isBlank() || grade.comment().length() > 4000) throw invalid();
        }
    }

    private WorkspaceError invalid() { return WorkspaceError.conflict("AI върна невалидни точки. Резултатът не е публикуван."); }

    private void publish(OrgAccess.Scope scope, Map<String, Object> original, long lease, AiProvider.GradedAnswers result) {
        long org = scope.organizationId(), id = number(original, "id"), attemptId = number(original, "attempt_id");
        organizations.lockQuota(org);
        entitlements.lockAi("grading",id);
        var attempt = authorizedAttempt(scope, attemptId, true);
        var job = repository.requireJobForUpdate(org, id);
        if (!string(job, "status").equals("running") || number(job, "attempts") != lease) return;
        var questions = questions(org, attemptId);
        checkSnapshot(job, attempt, questions);
        var grades = new HashMap<Long, AiProvider.AnswerGrade>();
        result.grades().forEach(grade -> grades.put(grade.questionId(), grade));
        for (var row : questions) {
            if (flag(row, "reviewed") && row.get("final_points") != null) continue;
            long questionId = number(row, "id");
            var grade = grades.getOrDefault(questionId, new AiProvider.AnswerGrade(questionId, BigDecimal.ZERO, "Няма окончателен текстов отговор."));
            grading.grade(scope, attemptId, new GradingService.GradeRequest(questionId, grade.points(), "AI: " + grade.comment(), "AI проверка"));
        }
        var revision = grading.finalizeResult(scope, attemptId, new GradingService.Finalize("ai-grading-" + id, "AI проверка", null, null), false);
        repository.markCompleted(result.model(), result.inputTokens(), result.outputTokens(), number(revision, "id"), clock.instant(), org, id);
        settleQuota(job, true);
        audit.write(org, scope.userId(), "grading.ai_published", attemptId, Map.of("job", id, "revision", number(revision, "id"), "model", Objects.toString(result.model(), "")));
    }

    private void fail(long org, long id, long lease, String message) {
        transactions.executeWithoutResult(tx -> {
            organizations.lockQuota(org);
            entitlements.lockAi("grading",id);
            var existing = repository.findJobForUpdate(org, id);
            if (existing.isEmpty()) return;
            var job = existing.get();
            if (!string(job, "status").equals("running") || number(job, "attempts") != lease) return;
            repository.markFailed(message.substring(0, Math.min(message.length(), 500)), clock.instant(), org, id);
            settleQuota(job, false);
        });
    }

    private void settleQuota(Map<String, Object> job, boolean success) {
        if (flag(job, "quota_reserved") && !entitlements.settleAi("grading",number(job,"id"),success)) repository.settleQuota(success ? 1 : 0, number(job, "organization_id"));
    }

    private Map<String, Object> safe(Map<String, Object> job) {
        var result = new LinkedHashMap<String, Object>();
        for (String key : List.of("id", "attempt_id", "status", "attempts", "error_message", "revision_id")) result.put(key, job.get(key));
        return result;
    }

    public record Request(String requestKey) {}
}
