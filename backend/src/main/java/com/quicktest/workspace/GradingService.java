package com.quicktest.workspace;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.util.*;
import static com.quicktest.workspace.WorkspaceStore.*;

@Service
public class GradingService {
    private final WorkspaceStore db;private final AssignmentService assignments;
    private final NotificationService notifications;private final WorkspaceAudit audit;private final Clock clock;
    public GradingService(WorkspaceStore db,AssignmentService assignments,NotificationService notifications,WorkspaceAudit audit,Clock clock) {this.db=db;this.assignments=assignments;this.notifications=notifications;this.audit=audit;this.clock=clock;}
    private Map<String,Object> teacherAttempt(OrgAccess.Scope scope,long id,boolean lock) {
        var attempt=db.one("SELECT * FROM exam_attempts WHERE organization_id=? AND id=?"+(lock?" FOR UPDATE":""),scope.organizationId(),id);
        assignments.teacherAccess(scope,number(attempt,"assignment_id"),false);return attempt;
    }
    public List<Map<String,Object>> queue(OrgAccess.Scope scope) {
        return db.rows("SELECT a.id,a.assignment_id,a.attempt_number,a.status,a.expired,a.submitted_at,u.name student_name,v.title FROM exam_attempts a JOIN exam_assignments s ON s.organization_id=a.organization_id AND s.id=a.assignment_id JOIN assessment_versions v ON v.organization_id=s.organization_id AND v.id=s.version_id JOIN users u ON u.id=a.student_id WHERE (a.organization_id=? OR ?) AND (s.teacher_id=? OR EXISTS (SELECT 1 FROM assignment_teachers t WHERE t.organization_id=s.organization_id AND t.assignment_id=s.id AND t.teacher_id=?)) AND a.status IN ('pending_review','finalized','voided') ORDER BY a.id DESC",scope.organizationId(),scope.platform(),scope.userId(),scope.userId());
    }
    public Map<String,Object> review(OrgAccess.Scope scope,long id) {
        var attempt=teacherAttempt(scope,id,false);Map<String,Object> result=new LinkedHashMap<>();result.put("attempt",attempt);
        // Session secrets and binding identifiers are never part of a teacher view.
        attempt.remove("session_hash");attempt.remove("auth_session_hash");attempt.remove("browser_id");attempt.remove("start_key");attempt.remove("active_key");
        result.put("student",db.one("SELECT id,name,email FROM users WHERE id=?",number(attempt,"student_id")));
        result.put("questions",db.rows("SELECT * FROM attempt_questions WHERE organization_id=? AND attempt_id=? ORDER BY position_index",scope.organizationId(),id));
        result.put("events",db.rows("SELECT question_id,open_instance,event_type,telemetry_json,received_at FROM exam_events WHERE organization_id=? AND attempt_id=? ORDER BY id",scope.organizationId(),id));
        result.put("revisions",db.rows("SELECT id,revision_number,points,maximum_points,percentage,grade,outcome,reason,published_at,author_id FROM result_revisions WHERE organization_id=? AND attempt_id=? ORDER BY revision_number",scope.organizationId(),id));
        return result;
    }
    @Transactional
    public void grade(OrgAccess.Scope scope,long id,GradeRequest request) {
        var attempt=teacherAttempt(scope,id,true);
        if(!Set.of("pending_review","finalized").contains(string(attempt,"status"))) throw WorkspaceError.conflict("Опитът не е готов за проверка.");
        var q=db.one("SELECT * FROM attempt_questions WHERE organization_id=? AND attempt_id=? AND id=?",scope.organizationId(),id,request.questionId());
        if(request.points()==null || request.points().compareTo(BigDecimal.ZERO)<0 || request.points().compareTo(decimal(q,"maximum_points"))>0 || request.points().scale()>4) throw WorkspaceError.validation("Точките трябва да са между 0 и максимума, с до 4 знака след запетаята.");
        boolean automatic=q.get("automatic_points")!=null;
        if((automatic && request.points().compareTo(decimal(q,"automatic_points"))!=0 || string(attempt,"status").equals("finalized")) && (request.reason()==null || request.reason().isBlank())) throw WorkspaceError.validation("Корекцията изисква причина.");
        db.update("UPDATE attempt_questions SET final_points=?,reviewed=TRUE,teacher_comment=?,override_reason=? WHERE organization_id=? AND id=?",request.points(),request.comment(),request.reason(),scope.organizationId(),request.questionId());
        audit.write(scope.organizationId(),scope.userId(),"grading.question_updated",id,Map.of("question",request.questionId(),"points",request.points(),"reason",Objects.toString(request.reason(),"")));
    }
    @Transactional
    public Map<String,Object> finalizeResult(OrgAccess.Scope scope,long id,Finalize request,boolean correction) {
        if(request.idempotencyKey()==null || !request.idempotencyKey().matches("[A-Za-z0-9_-]{8,80}")) throw WorkspaceError.validation("Невалиден ключ за публикуване.");
        var attempt=teacherAttempt(scope,id,true);
        var existing=db.optional("SELECT * FROM result_revisions WHERE organization_id=? AND attempt_id=? AND publication_key=?",scope.organizationId(),id,request.idempotencyKey());
        if(existing.isPresent()) return publication(existing.get());
        String status=string(attempt,"status");
        if(!correction && status.equals("finalized")) return publication(db.one("SELECT * FROM result_revisions WHERE organization_id=? AND attempt_id=? ORDER BY revision_number DESC LIMIT 1",scope.organizationId(),id));
        if(!Set.of("pending_review","finalized").contains(status) || correction && !status.equals("finalized")) throw WorkspaceError.conflict("Опитът не е готов за това действие.");
        boolean override=request.gradeOverride()!=null && !request.gradeOverride().isBlank() || request.outcomeOverride()!=null && !request.outcomeOverride().isBlank();
        if((correction || override) && (request.reason()==null || request.reason().isBlank())) throw WorkspaceError.validation("Корекцията изисква причина.");
        var questions=db.rows("SELECT * FROM attempt_questions WHERE organization_id=? AND attempt_id=? ORDER BY position_index",scope.organizationId(),id);
        if(questions.stream().anyMatch(q->!flag(q,"reviewed") || q.get("final_points")==null)) throw WorkspaceError.conflict("Всички свободни отговори трябва да бъдат проверени.");
        BigDecimal points=questions.stream().map(q->decimal(q,"final_points")).reduce(BigDecimal.ZERO,BigDecimal::add);
        BigDecimal maximum=questions.stream().map(q->decimal(q,"maximum_points")).reduce(BigDecimal.ZERO,BigDecimal::add);
        BigDecimal percent=points.multiply(new BigDecimal("100")).divide(maximum,8,RoundingMode.HALF_UP);
        var assignment=assignments.teacherAccess(scope,number(attempt,"assignment_id"),false);
        var definition=db.parse(assignment.get("definition_json"),AssessmentService.Definition.class);
        String outcome=points.multiply(new BigDecimal("100")).compareTo(maximum.multiply(definition.passThreshold()))>=0?"passed":"failed";
        String grade=switch(definition.gradingScale()) {case "percentage"->percent.stripTrailingZeros().toPlainString()+"%";case "pass_fail"->outcome;default->bulgarianGrade(points,maximum);};
        if(request.gradeOverride()!=null && !request.gradeOverride().isBlank()) {
            if(request.gradeOverride().length()>40) throw WorkspaceError.validation("Невалидна оценка.");grade=request.gradeOverride();
        }
        if(request.outcomeOverride()!=null && !request.outcomeOverride().isBlank()) {
            if(!Set.of("passed","failed").contains(request.outcomeOverride())) throw WorkspaceError.validation("Невалиден изход.");outcome=request.outcomeOverride();
        }
        int next=(int)db.count("SELECT COALESCE(MAX(revision_number),0)+1 FROM result_revisions WHERE organization_id=? AND attempt_id=?",scope.organizationId(),id);
        Map<String,Object> snapshot=new LinkedHashMap<>();snapshot.put("questions",questions);snapshot.put("gradeOverridden",request.gradeOverride()!=null && !request.gradeOverride().isBlank());snapshot.put("outcomeOverridden",request.outcomeOverride()!=null && !request.outcomeOverride().isBlank());snapshot.put("gradingScale",definition.gradingScale());snapshot.put("passThreshold",definition.passThreshold());
        long revision=db.insert("INSERT INTO result_revisions(organization_id,attempt_id,revision_number,publication_key,author_id,points,maximum_points,percentage,grade,outcome,reason,snapshot_json,published_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",scope.organizationId(),id,next,request.idempotencyKey(),scope.userId(),points,maximum,percent,grade,outcome,Objects.toString(request.reason(),""),db.json(snapshot),clock.instant());
        db.update("UPDATE exam_attempts SET status='finalized' WHERE organization_id=? AND id=?",scope.organizationId(),id);
        long student=number(attempt,"student_id");String email=notifications.verifiedAddress(student);
        var organization=db.one("SELECT name FROM organizations WHERE id=?",scope.organizationId());var user=db.one("SELECT name FROM users WHERE id=?",student);
        Map<String,Object> message=new LinkedHashMap<>(Map.of("organization",scope.platform()?"ExamAI":string(organization,"name"),"test",string(assignment,"title"),"student",string(user,"name"),"attemptNumber",number(attempt,"attempt_number"),"points",points,"maximumPoints",maximum,"percentage",percent,"grade",grade,"outcome",outcome,"protectedPath","/results/"+id));
        message.put("corrected",correction);message.put("publishedAt",clock.instant());
        notifications.enqueue(scope.organizationId(),revision,student,"final_result",email,message);
        audit.write(scope.organizationId(),scope.userId(),correction?"result.corrected":"result.published",id,Map.of("revision",next,"reason",Objects.toString(request.reason(),"")));
        return publication(db.one("SELECT * FROM result_revisions WHERE organization_id=? AND id=?",scope.organizationId(),revision));
    }
    public static String bulgarianGrade(BigDecimal points,BigDecimal maximum) {
        for(int[] band:new int[][]{{90,6},{75,5},{60,4},{50,3}}) if(points.multiply(new BigDecimal("100")).compareTo(maximum.multiply(BigDecimal.valueOf(band[0])))>=0) return Integer.toString(band[1]);
        return "2";
    }
    private Map<String,Object> publication(Map<String,Object> revision) {
        Map<String,Object> safe=new LinkedHashMap<>(revision);safe.remove("snapshot_json");safe.remove("publication_key");return safe;
    }
    public List<Map<String,Object>> results(OrgAccess.Scope scope) {
        return db.rows("SELECT r.id,r.attempt_id,r.revision_number,r.points,r.maximum_points,r.percentage,r.grade,r.outcome,r.published_at,a.assignment_id,a.attempt_number,v.title FROM result_revisions r JOIN exam_attempts a ON a.organization_id=r.organization_id AND a.id=r.attempt_id JOIN exam_assignments s ON s.organization_id=a.organization_id AND s.id=a.assignment_id JOIN assessment_versions v ON v.organization_id=s.organization_id AND v.id=s.version_id WHERE (r.organization_id=? OR ?) AND a.student_id=? AND a.status='finalized' AND r.revision_number=(SELECT MAX(rr.revision_number) FROM result_revisions rr WHERE rr.organization_id=r.organization_id AND rr.attempt_id=r.attempt_id) ORDER BY a.attempt_number DESC,r.published_at DESC",scope.organizationId(),scope.platform(),scope.userId());
    }
    public List<Map<String,Object>> assignmentResults(OrgAccess.Scope scope) {
        var latest=new LinkedHashMap<Long,Map<String,Object>>();
        // Results are ordered by attempt number, not by correction publication time.
        for(var result:results(scope)) latest.putIfAbsent(number(result,"assignment_id"),result);
        return new ArrayList<>(latest.values());
    }
    public Map<String,Object> studentResult(OrgAccess.Scope scope,long id) {
        var attempt=db.one("SELECT * FROM exam_attempts WHERE organization_id=? AND id=? AND student_id=? AND status='finalized'",scope.organizationId(),id,scope.userId());
        var revision=db.one("SELECT * FROM result_revisions WHERE organization_id=? AND attempt_id=? ORDER BY revision_number DESC LIMIT 1",scope.organizationId(),id);
        var result=publication(revision);var assignment=db.one("SELECT ends_at,answers_after_deadline FROM exam_assignments WHERE organization_id=? AND id=?",scope.organizationId(),number(attempt,"assignment_id"));
        if(!flag(assignment,"answers_after_deadline") || !clock.instant().isBefore(time(assignment,"ends_at"))) result.put("details",db.object(revision.get("snapshot_json")));
        return result;
    }
    @Transactional
    public void voidAttempt(OrgAccess.Scope scope,long id,String reason) {
        teacherAttempt(scope,id,true);if(reason==null || reason.isBlank()) throw WorkspaceError.validation("Нужна е причина.");
        db.update("UPDATE exam_attempts SET status='voided',active_key=NULL,void_reason=? WHERE organization_id=? AND id=?",reason,scope.organizationId(),id);
        audit.write(scope.organizationId(),scope.userId(),"attempt.voided",id,Map.of("reason",reason));
    }
    public record GradeRequest(long questionId,BigDecimal points,String comment,String reason) {}
    public record Finalize(String idempotencyKey,String reason,String gradeOverride,String outcomeOverride) {}
}
