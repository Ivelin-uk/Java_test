package com.quicktest.workspace;

import com.quicktest.workspace.repository.GradingRepository;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.util.*;
import static com.quicktest.workspace.WorkspaceValues.*;

@Service
public class GradingService {
    private final WorkspaceJson json;
    private final GradingRepository repository;private final AssignmentService assignments;
    private final NotificationService notifications;private final WorkspaceAudit audit;private final Clock clock;
    public GradingService(GradingRepository repository,WorkspaceJson json,AssignmentService assignments,NotificationService notifications,WorkspaceAudit audit,Clock clock) {this.repository=repository;this.json=json;this.assignments=assignments;this.notifications=notifications;this.audit=audit;this.clock=clock;}
    private Map<String,Object> teacherAttempt(OrgAccess.Scope scope,long id,boolean lock) {
        var attempt=repository.findAttempt(scope.organizationId(), id, lock);
        assignments.teacherAccess(scope,number(attempt,"assignment_id"),false);return attempt;
    }
    public List<Map<String,Object>> queue(OrgAccess.Scope scope) {
        var rows=repository.findTeacherQueue(scope.organizationId(), scope.platform(), scope.userId(), scope.userId());
        for(var row:rows) row.put("group_assignment",json.parse(row.remove("source_groups_json"),Long[].class).length>0);
        return rows;
    }
    public Map<String,Object> review(OrgAccess.Scope scope,long id) {
        var attempt=teacherAttempt(scope,id,false);Map<String,Object> result=new LinkedHashMap<>();result.put("attempt",attempt);
        // Session secrets and binding identifiers are never part of a teacher view.
        attempt.remove("session_hash");attempt.remove("auth_session_hash");attempt.remove("browser_id");attempt.remove("start_key");attempt.remove("active_key");
        result.put("student",repository.requireStudent(number(attempt,"student_id")));
        result.put("questions",repository.findQuestions(scope.organizationId(), id));
        result.put("events",repository.findEvents(scope.organizationId(), id));
        result.put("revisions",repository.findRevisions(scope.organizationId(), id));
        return result;
    }
    @Transactional
    public void grade(OrgAccess.Scope scope,long id,GradeRequest request) {
        var attempt=teacherAttempt(scope,id,true);
        if(!Set.of("pending_review","finalized").contains(string(attempt,"status"))) throw WorkspaceError.conflict("Опитът не е готов за проверка.");
        var q=repository.requireQuestion(scope.organizationId(), id, request.questionId());
        if(request.points()==null || request.points().compareTo(BigDecimal.ZERO)<0 || request.points().compareTo(decimal(q,"maximum_points"))>0 || request.points().scale()>4) throw WorkspaceError.validation("Точките трябва да са между 0 и максимума, с до 4 знака след запетаята.");
        boolean automatic=q.get("automatic_points")!=null;
        if((automatic && request.points().compareTo(decimal(q,"automatic_points"))!=0 || string(attempt,"status").equals("finalized")) && (request.reason()==null || request.reason().isBlank())) throw WorkspaceError.validation("Корекцията изисква причина.");
        repository.saveGrade(request.points(), request.comment(), request.reason(), scope.organizationId(), request.questionId());
        audit.write(scope.organizationId(),scope.userId(),"grading.question_updated",id,Map.of("question",request.questionId(),"points",request.points(),"reason",Objects.toString(request.reason(),"")));
    }
    @Transactional
    public Map<String,Object> finalizeResult(OrgAccess.Scope scope,long id,Finalize request,boolean correction) {
        if(request.idempotencyKey()==null || !request.idempotencyKey().matches("[A-Za-z0-9_-]{8,80}")) throw WorkspaceError.validation("Невалиден ключ за публикуване.");
        var attempt=teacherAttempt(scope,id,true);
        var existing=repository.findPublication(scope.organizationId(), id, request.idempotencyKey());
        if(existing.isPresent()) return publication(existing.get());
        String status=string(attempt,"status");
        if(!correction && status.equals("finalized")) return publication(repository.requireLatestRevision(scope.organizationId(), id));
        if(!Set.of("pending_review","finalized").contains(status) || correction && !status.equals("finalized")) throw WorkspaceError.conflict("Опитът не е готов за това действие.");
        boolean override=request.gradeOverride()!=null && !request.gradeOverride().isBlank() || request.outcomeOverride()!=null && !request.outcomeOverride().isBlank();
        if((correction || override) && (request.reason()==null || request.reason().isBlank())) throw WorkspaceError.validation("Корекцията изисква причина.");
        var questions=repository.findQuestions(scope.organizationId(), id);
        if(questions.stream().anyMatch(q->!flag(q,"reviewed") || q.get("final_points")==null)) throw WorkspaceError.conflict("Всички свободни отговори трябва да бъдат проверени.");
        BigDecimal points=questions.stream().map(q->decimal(q,"final_points")).reduce(BigDecimal.ZERO,BigDecimal::add);
        BigDecimal maximum=questions.stream().map(q->decimal(q,"maximum_points")).reduce(BigDecimal.ZERO,BigDecimal::add);
        BigDecimal percent=points.multiply(new BigDecimal("100")).divide(maximum,8,RoundingMode.HALF_UP);
        var assignment=assignments.teacherAccess(scope,number(attempt,"assignment_id"),false);
        var definition=json.parse(assignment.get("definition_json"),AssessmentService.Definition.class);
        String outcome=points.multiply(new BigDecimal("100")).compareTo(maximum.multiply(definition.passThreshold()))>=0?"passed":"failed";
        String grade=switch(definition.gradingScale()) {case "percentage"->percent.stripTrailingZeros().toPlainString()+"%";case "pass_fail"->outcome;default->bulgarianGrade(points,maximum);};
        if(request.gradeOverride()!=null && !request.gradeOverride().isBlank()) {
            if(request.gradeOverride().length()>40) throw WorkspaceError.validation("Невалидна оценка.");grade=request.gradeOverride();
        }
        if(request.outcomeOverride()!=null && !request.outcomeOverride().isBlank()) {
            if(!Set.of("passed","failed").contains(request.outcomeOverride())) throw WorkspaceError.validation("Невалиден изход.");outcome=request.outcomeOverride();
        }
        int next=(int)repository.nextRevisionNumber(scope.organizationId(), id);
        Map<String,Object> snapshot=new LinkedHashMap<>();snapshot.put("questions",questions);snapshot.put("gradeOverridden",request.gradeOverride()!=null && !request.gradeOverride().isBlank());snapshot.put("outcomeOverridden",request.outcomeOverride()!=null && !request.outcomeOverride().isBlank());snapshot.put("gradingScale",definition.gradingScale());snapshot.put("passThreshold",definition.passThreshold());
        long revision=repository.insertRevision(scope.organizationId(), id, next, request.idempotencyKey(), scope.userId(), points, maximum, percent, grade, outcome, Objects.toString(request.reason(),""), json.write(snapshot), clock.instant());
        repository.markFinalized(scope.organizationId(), id);
        long student=number(attempt,"student_id");
        var saved=repository.requireRevision(scope.organizationId(),revision);
        notifications.enqueue(scope.organizationId(),revision,student,"final_result",notifications.verifiedAddress(student),resultMessage(scope,attempt,assignment,saved));
        audit.write(scope.organizationId(),scope.userId(),correction?"result.corrected":"result.published",id,Map.of("revision",next,"reason",Objects.toString(request.reason(),"")));
        return publication(repository.requireRevision(scope.organizationId(), revision));
    }
    private Map<String,Object> resultMessage(OrgAccess.Scope scope,Map<String,Object> attempt,Map<String,Object> assignment,Map<String,Object> revision) {
        var organization=repository.requireOrganizationName(scope.organizationId());
        var user=repository.requireStudentName(number(attempt,"student_id"));
        Map<String,Object> message=new LinkedHashMap<>();
        message.put("organization",scope.platform()?"ExamAI":string(organization,"name"));message.put("test",string(assignment,"title"));message.put("student",string(user,"name"));
        message.put("attemptNumber",number(attempt,"attempt_number"));message.put("points",revision.get("points"));message.put("maximumPoints",revision.get("maximum_points"));
        message.put("percentage",revision.get("percentage"));message.put("grade",string(revision,"grade"));message.put("outcome",string(revision,"outcome"));
        message.put("protectedPath","/results/"+number(attempt,"id"));message.put("corrected",number(revision,"revision_number")>1);message.put("publishedAt",time(revision,"published_at"));
        return message;
    }
    @Transactional
    public Map<String,Object> emailResult(OrgAccess.Scope scope,long id) {
        var attempt=teacherAttempt(scope,id,true);
        if(!string(attempt,"status").equals("finalized")) throw WorkspaceError.conflict("Първо публикувайте резултата от проверката.");
        var revision=repository.requireLatestRevision(scope.organizationId(),id);
        var assignment=assignments.teacherAccess(scope,number(attempt,"assignment_id"),false);
        var delivery=notifications.ensureResultDelivery(scope.organizationId(),number(revision,"id"),number(attempt,"student_id"),resultMessage(scope,attempt,assignment,revision));
        audit.write(scope.organizationId(),scope.userId(),"result.email_requested",id,Map.of("revision",number(revision,"revision_number"),"notification",delivery.get("id")));
        return delivery;
    }
    public static String bulgarianGrade(BigDecimal points,BigDecimal maximum) {
        for(int[] band:new int[][]{{90,6},{75,5},{60,4},{50,3}}) if(points.multiply(new BigDecimal("100")).compareTo(maximum.multiply(BigDecimal.valueOf(band[0])))>=0) return Integer.toString(band[1]);
        return "2";
    }
    private Map<String,Object> publication(Map<String,Object> revision) {
        Map<String,Object> safe=new LinkedHashMap<>(revision);safe.remove("snapshot_json");safe.remove("publication_key");return safe;
    }
    public List<Map<String,Object>> results(OrgAccess.Scope scope) {
        return repository.findStudentResults(scope.organizationId(), scope.platform(), scope.userId());
    }
    public List<Map<String,Object>> assignmentResults(OrgAccess.Scope scope) {
        var latest=new LinkedHashMap<Long,Map<String,Object>>();
        // Results are ordered by attempt number, not by correction publication time.
        for(var result:results(scope)) latest.putIfAbsent(number(result,"assignment_id"),result);
        return new ArrayList<>(latest.values());
    }
    public Map<String,Object> studentResult(OrgAccess.Scope scope,long id) {
        var attempt=repository.requireFinalizedStudentAttempt(scope.organizationId(), id, scope.userId());
        var revision=repository.requireLatestRevision(scope.organizationId(), id);
        var result=publication(revision);var assignment=repository.requireReleasePolicy(scope.organizationId(), number(attempt,"assignment_id"));
        if(!flag(assignment,"answers_after_deadline") || !clock.instant().isBefore(time(assignment,"ends_at"))) result.put("details",json.object(revision.get("snapshot_json")));
        return result;
    }
    @Transactional
    public void voidAttempt(OrgAccess.Scope scope,long id,String reason) {
        teacherAttempt(scope,id,true);if(reason==null || reason.isBlank()) throw WorkspaceError.validation("Нужна е причина.");
        repository.voidAttempt(reason, scope.organizationId(), id);
        audit.write(scope.organizationId(),scope.userId(),"attempt.voided",id,Map.of("reason",reason));
    }
    public record GradeRequest(long questionId,BigDecimal points,String comment,String reason) {}
    public record Finalize(String idempotencyKey,String reason,String gradeOverride,String outcomeOverride) {}
}
