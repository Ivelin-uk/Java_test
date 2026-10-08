package com.quicktest.workspace;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.util.*;
import static com.quicktest.workspace.WorkspaceStore.*;

@Service
public class AssignmentService {
    private final WorkspaceStore db;
    private final OrganizationService organizations;
    private final WorkspaceCrypto crypto;
    private final WorkspaceAudit audit;
    private final Clock clock;private final NotificationService notifications;private final boolean mobileValidated;
    public AssignmentService(WorkspaceStore db,OrganizationService organizations,WorkspaceCrypto crypto,WorkspaceAudit audit,Clock clock,NotificationService notifications,@org.springframework.beans.factory.annotation.Value("${app.exam.mobile-validated:false}") boolean mobileValidated) {this.db=db;this.organizations=organizations;this.crypto=crypto;this.audit=audit;this.clock=clock;this.notifications=notifications;this.mobileValidated=mobileValidated;}
    public Map<String,Object> teacherAccess(OrgAccess.Scope scope,long id,boolean lock) {
        var assignment=db.one("SELECT a.*,v.title,v.definition_json FROM exam_assignments a JOIN assessment_versions v ON v.organization_id=a.organization_id AND v.id=a.version_id WHERE a.organization_id=? AND a.id=?"+(lock?" FOR UPDATE":""),scope.organizationId(),id);
        if(number(assignment,"teacher_id")!=scope.userId() && db.count("SELECT COUNT(*) FROM assignment_teachers WHERE organization_id=? AND assignment_id=? AND teacher_id=?",scope.organizationId(),id,scope.userId())==0) throw WorkspaceError.forbidden();
        return assignment;
    }
    public List<Map<String,Object>> list(OrgAccess.Scope scope) {
        if(scope.roles().contains("TEACHER")) return db.rows("SELECT a.id,a.version_id,a.teacher_id,a.starts_at,a.ends_at,a.max_attempts,v.title,(SELECT COUNT(*) FROM assignment_recipients r WHERE r.organization_id=a.organization_id AND r.assignment_id=a.id) recipients FROM exam_assignments a JOIN assessment_versions v ON v.organization_id=a.organization_id AND v.id=a.version_id WHERE (a.organization_id=? OR ?) AND (a.teacher_id=? OR EXISTS (SELECT 1 FROM assignment_teachers t WHERE t.organization_id=a.organization_id AND t.assignment_id=a.id AND t.teacher_id=?)) ORDER BY a.id DESC",scope.organizationId(),scope.platform(),scope.userId(),scope.userId());
        return db.rows("SELECT a.id,a.starts_at,a.ends_at,r.max_attempts,r.canceled,r.fullscreen_exempt,r.time_multiplier,v.title FROM exam_assignments a JOIN assessment_versions v ON v.organization_id=a.organization_id AND v.id=a.version_id JOIN assignment_recipients r ON r.organization_id=a.organization_id AND r.assignment_id=a.id WHERE (a.organization_id=? OR ?) AND r.student_id=? ORDER BY a.ends_at DESC",scope.organizationId(),scope.platform(),scope.userId());
    }
    @Transactional
    public Map<String,Object> create(OrgAccess.Scope scope,AssignmentRequest request) {
        if(!scope.platform()) organizations.requirePaid(scope.organizationId());
        if(request.startsAt()==null || request.endsAt()==null || !request.startsAt().isBefore(request.endsAt()) || !clock.instant().isBefore(request.endsAt()) || request.maxAttempts()<1 || request.maxAttempts()>20) throw WorkspaceError.validation("Невалиден период или брой опити.");
        var version=db.one("SELECT v.*,t.owner_id,t.shared,t.status FROM assessment_versions v JOIN workspace_assessments t ON t.organization_id=v.organization_id AND t.id=v.assessment_id WHERE v.organization_id=? AND v.id=?",scope.organizationId(),request.versionId());
        if(!flag(version,"shared") && number(version,"owner_id")!=scope.userId() || string(version,"status").equals("archived")) throw WorkspaceError.forbidden();
        if(scope.platform()) organizations.requireActiveMember(scope,scope.userId(),"TEACHER");
        Map<Long,Set<Long>> recipients=new LinkedHashMap<>(); Set<Long> individual=new HashSet<>(request.studentIds()==null?List.of():request.studentIds());
        for(Long user:individual) {organizations.requireActiveMember(scope,user,"STUDENT");recipients.put(user,new LinkedHashSet<>());}
        for(Long group:request.groupIds()==null?List.<Long>of():request.groupIds()) {
            if(!string(organizations.groupAccess(scope,group),"status").equals("active")) throw WorkspaceError.conflict("Групата е архивирана.");
            long groupWorkspace=number(organizations.groupAccess(scope,group),"organization_id");
            for(var member:db.rows("SELECT g.user_id FROM group_members g JOIN memberships m ON m.organization_id=g.organization_id AND m.user_id=g.user_id WHERE g.organization_id=? AND g.group_id=? AND g.active=TRUE AND m.status='active' AND m.roles_json LIKE '%STUDENT%'",groupWorkspace,group)) {long user=number(member,"user_id");organizations.requireActiveMember(scope,user,"STUDENT");recipients.computeIfAbsent(user,key->new LinkedHashSet<>()).add(group);}
        }
        if(recipients.isEmpty()) throw WorkspaceError.validation("Изберете поне един получател.");
        long id=db.insert("INSERT INTO exam_assignments(organization_id,version_id,teacher_id,starts_at,ends_at,max_attempts,shuffle_questions,shuffle_options,answers_after_deadline,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",scope.organizationId(),request.versionId(),scope.userId(),request.startsAt(),request.endsAt(),request.maxAttempts(),request.shuffleQuestions(),request.shuffleOptions(),request.answersAfterDeadline(),clock.instant());
        for(var recipient:recipients.entrySet()) db.update("INSERT INTO assignment_recipients(organization_id,assignment_id,student_id,source_groups_json,individually_assigned,max_attempts) VALUES(?,?,?,?,?,?)",scope.organizationId(),id,recipient.getKey(),db.json(recipient.getValue()),individual.contains(recipient.getKey()),request.maxAttempts());
        String code=crypto.code();db.update("UPDATE exam_assignments SET code_hash=? WHERE id=? AND organization_id=?",codeHash(scope.organizationId(),id,code),id,scope.organizationId());
        audit.write(scope.organizationId(),scope.userId(),"assignment.created",id,Map.of("recipients",recipients.size(),"version",request.versionId()));
        return Map.of("id",id,"code",code,"recipients",recipients.size());
    }
    public String codeHash(long org,long assignment,String code) {return crypto.hash(org+":"+assignment+":"+code.strip().toUpperCase(Locale.ROOT));}
    @Transactional
    public Map<String,Object> rotate(OrgAccess.Scope scope,long id) {
        teacherAccess(scope,id,true);String code=crypto.code();
        db.update("UPDATE exam_assignments SET code_hash=?,code_generation=code_generation+1 WHERE organization_id=? AND id=?",codeHash(scope.organizationId(),id,code),scope.organizationId(),id);
        audit.write(scope.organizationId(),scope.userId(),"assignment.code_rotated",id,Map.of());
        return Map.of("code",code);
    }
    @Transactional
    public void revoke(OrgAccess.Scope scope,long id) {
        teacherAccess(scope,id,true);db.update("UPDATE exam_assignments SET code_hash=NULL WHERE organization_id=? AND id=?",scope.organizationId(),id);
        audit.write(scope.organizationId(),scope.userId(),"assignment.code_revoked",id,Map.of());
    }
    @Transactional
    public void accommodate(OrgAccess.Scope scope,long id,long user,Accommodation request) {
        teacherAccess(scope,id,false);
        if(request.reason()==null || request.reason().isBlank() || request.timeMultiplier()==null || request.timeMultiplier().compareTo(BigDecimal.ONE)<0 || request.timeMultiplier().compareTo(new BigDecimal("5"))>0 || request.maxAttempts()<1 || request.maxAttempts()>20) throw WorkspaceError.validation("Изключението изисква причина, време 1–5 и опити 1–20.");
        db.one("SELECT * FROM assignment_recipients WHERE organization_id=? AND assignment_id=? AND student_id=? FOR UPDATE",scope.organizationId(),id,user);
        teacherAccess(scope,id,true);
        if(db.count("SELECT COUNT(*) FROM exam_attempts WHERE organization_id=? AND assignment_id=? AND student_id=? AND status='in_progress'",scope.organizationId(),id,user)>0) throw WorkspaceError.conflict("Изключенията не променят активен опит.");
        db.update("UPDATE assignment_recipients SET fullscreen_exempt=?,time_multiplier=?,max_attempts=?,accommodation_reason=? WHERE organization_id=? AND assignment_id=? AND student_id=?",request.fullscreenExempt(),request.timeMultiplier(),request.maxAttempts(),request.reason(),scope.organizationId(),id,user);
        audit.write(scope.organizationId(),scope.userId(),"assignment.accommodation",id,Map.of("student",user,"reason",request.reason(),"fullscreenExempt",request.fullscreenExempt(),"timeMultiplier",request.timeMultiplier(),"maxAttempts",request.maxAttempts()));
    }
    public List<Map<String,Object>> monitoring(OrgAccess.Scope scope,long id) {
        teacherAccess(scope,id,false);
        return db.rows("SELECT r.student_id,u.name,r.canceled,r.max_attempts,r.fullscreen_exempt,r.time_multiplier,r.accommodation_reason,a.id attempt_id,a.attempt_number,a.status,a.current_position,a.started_at,a.submitted_at FROM assignment_recipients r JOIN users u ON u.id=r.student_id LEFT JOIN exam_attempts a ON a.organization_id=r.organization_id AND a.assignment_id=r.assignment_id AND a.student_id=r.student_id WHERE r.organization_id=? AND r.assignment_id=? ORDER BY u.name,a.attempt_number DESC",scope.organizationId(),id);
    }
    public Map<String,Object> preflight(OrgAccess.Scope scope,long id) {
        var row=db.one("SELECT a.id,a.starts_at,a.ends_at,v.title,v.definition_json,r.max_attempts,r.fullscreen_exempt,r.time_multiplier,r.canceled FROM exam_assignments a JOIN assessment_versions v ON v.organization_id=a.organization_id AND v.id=a.version_id JOIN assignment_recipients r ON r.organization_id=a.organization_id AND r.assignment_id=a.id WHERE a.organization_id=? AND a.id=? AND r.student_id=?",scope.organizationId(),id,scope.userId());
        if(flag(row,"canceled")) throw WorkspaceError.forbidden();
        AssessmentService.Definition definition=db.parse(row.remove("definition_json"),AssessmentService.Definition.class);
        row.put("mobile_validated",mobileValidated);row.put("instructions",definition.instructions());row.put("question_count",definition.questions().size());
        row.put("total_seconds",definition.questions().stream().mapToLong(q->(long)Math.ceil(q.timeSeconds()*decimal(row,"time_multiplier").doubleValue())).sum());
        return row;
    }
    @Transactional public void shareTeacher(OrgAccess.Scope scope,long id,long teacher,boolean shared) {
        var assignment=teacherAccess(scope,id,true);if(number(assignment,"teacher_id")!=scope.userId()) throw WorkspaceError.forbidden();organizations.requireActiveMember(scope,teacher,"TEACHER");
        if(shared) db.update("INSERT INTO assignment_teachers(organization_id,assignment_id,teacher_id) VALUES(?,?,?) ON DUPLICATE KEY UPDATE teacher_id=teacher_id",scope.organizationId(),id,teacher);
        else db.update("DELETE FROM assignment_teachers WHERE organization_id=? AND assignment_id=? AND teacher_id=?",scope.organizationId(),id,teacher);
        audit.write(scope.organizationId(),scope.userId(),"assignment.teacher_access_changed",id,Map.of("teacher",teacher,"shared",shared));
    }
    public Object sharedTeachers(OrgAccess.Scope scope,long id) {teacherAccess(scope,id,false);return db.rows("SELECT t.teacher_id,u.name FROM assignment_teachers t JOIN users u ON u.id=t.teacher_id WHERE t.organization_id=? AND t.assignment_id=? ORDER BY u.name",scope.organizationId(),id);}
    @Transactional public void addRecipient(OrgAccess.Scope scope,long id,long student) {
        var assignment=teacherAccess(scope,id,false);if(!scope.platform()) organizations.requirePaid(scope.organizationId());organizations.requireActiveMember(scope,student,"STUDENT");
        if(!clock.instant().isBefore(time(assignment,"ends_at"))) throw WorkspaceError.expired("Срокът за това възлагане е изтекъл.");
        db.update("INSERT INTO assignment_recipients(organization_id,assignment_id,student_id,source_groups_json,individually_assigned,max_attempts) VALUES(?,?,?,'[]',TRUE,?) ON DUPLICATE KEY UPDATE individually_assigned=TRUE,canceled=FALSE",scope.organizationId(),id,student,number(assignment,"max_attempts"));
        audit.write(scope.organizationId(),scope.userId(),"assignment.recipient_added",id,Map.of("student",student));
    }
    public record AssignmentRequest(long versionId,List<Long> groupIds,List<Long> studentIds,Instant startsAt,Instant endsAt,int maxAttempts,boolean shuffleQuestions,boolean shuffleOptions,boolean answersAfterDeadline) {}
    public record Accommodation(boolean fullscreenExempt,BigDecimal timeMultiplier,int maxAttempts,String reason) {}
    @Transactional public Object dispatchCode(OrgAccess.Scope scope,long id,CodeDelivery request) {
        teacherAccess(scope,id,false);
        // Start and accommodation also lock recipients before their assignment parent.
        db.rows("SELECT student_id FROM assignment_recipients WHERE organization_id=? AND assignment_id=? ORDER BY student_id FOR UPDATE",scope.organizationId(),id);
        var assignment=teacherAccess(scope,id,true);
        if(request.code()==null || !"email".equals(request.channel()) || !codeHash(scope.organizationId(),id,request.code()).equals(string(assignment,"code_hash"))) throw WorkspaceError.validation("Невалиден или отменен код.");
        int sent=0;var organization=db.one("SELECT name FROM organizations WHERE id=?",scope.organizationId());
        for(var recipient:db.rows("SELECT student_id FROM assignment_recipients WHERE organization_id=? AND assignment_id=? AND canceled=FALSE",scope.organizationId(),id)) {
            long student=number(recipient,"student_id");
            if(db.count("SELECT COUNT(*) FROM assignment_code_deliveries WHERE organization_id=? AND assignment_id=? AND generation=? AND student_id=? AND channel=?",scope.organizationId(),id,number(assignment,"code_generation"),student,request.channel())>0) continue;
            notifications.enqueue(scope.organizationId(),null,student,"assignment_code",notifications.verifiedAddress(student),Map.of("code",request.code().strip().toUpperCase(Locale.ROOT),"test",string(assignment,"title"),"organization",scope.platform()?"ExamAI":string(organization,"name")));
            db.update("INSERT INTO assignment_code_deliveries(organization_id,assignment_id,generation,student_id,channel,created_at) VALUES(?,?,?,?,?,?)",scope.organizationId(),id,number(assignment,"code_generation"),student,request.channel(),clock.instant());sent++;
        }
        audit.write(scope.organizationId(),scope.userId(),"assignment.code_dispatched",id,Map.of("channel",request.channel(),"recipients",sent));return Map.of("queued",sent);
    }
    public record CodeDelivery(String code,String channel) {}
}
