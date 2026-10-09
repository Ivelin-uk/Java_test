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
    @Transactional(readOnly=true)
    public List<Map<String,Object>> list(OrgAccess.Scope scope) {
        if(scope.roles().contains("TEACHER")) return teacherList(scope);
        return db.rows("SELECT a.id,a.starts_at,a.ends_at,r.max_attempts,r.canceled,r.fullscreen_exempt,r.time_multiplier,v.title FROM exam_assignments a JOIN assessment_versions v ON v.organization_id=a.organization_id AND v.id=a.version_id JOIN assignment_recipients r ON r.organization_id=a.organization_id AND r.assignment_id=a.id WHERE (a.organization_id=? OR ?) AND r.student_id=? AND r.canceled=FALSE ORDER BY a.ends_at DESC",scope.organizationId(),scope.platform(),scope.userId());
    }
    private List<Map<String,Object>> teacherList(OrgAccess.Scope scope) {
        var assignments=db.rows("SELECT a.id,a.version_id,a.teacher_id,a.starts_at,a.ends_at,a.max_attempts,v.title,(SELECT COUNT(*) FROM assignment_recipients r WHERE r.organization_id=a.organization_id AND r.assignment_id=a.id AND r.canceled=FALSE) recipients FROM exam_assignments a JOIN assessment_versions v ON v.organization_id=a.organization_id AND v.id=a.version_id WHERE (a.organization_id=? OR ?) AND (a.teacher_id=? OR EXISTS (SELECT 1 FROM assignment_teachers t WHERE t.organization_id=a.organization_id AND t.assignment_id=a.id AND t.teacher_id=?)) ORDER BY a.id DESC",scope.organizationId(),scope.platform(),scope.userId(),scope.userId());
        if(assignments.isEmpty()) return assignments;
        var ids=assignments.stream().map(a->number(a,"id")).toList();
        String placeholders=String.join(",",Collections.nCopies(ids.size(),"?"));
        var recipients=db.rows("SELECT r.assignment_id,r.student_id,r.source_groups_json,r.individually_assigned,u.name FROM assignment_recipients r JOIN users u ON u.id=r.student_id WHERE r.assignment_id IN ("+placeholders+") ORDER BY u.name,r.student_id",ids.toArray());
        Map<Long,Set<Long>> sources=new HashMap<>();
        Map<Long,List<Map<String,Object>>> individuals=new HashMap<>();
        for(var recipient:recipients) {
            long id=number(recipient,"assignment_id");
            sources.computeIfAbsent(id,key->new LinkedHashSet<>()).addAll(Arrays.asList(db.parse(recipient.get("source_groups_json"),Long[].class)));
            if(flag(recipient,"individually_assigned")) individuals.computeIfAbsent(id,key->new ArrayList<>()).add(Map.of("id",number(recipient,"student_id"),"name",string(recipient,"name")));
        }
        // Resolve only groups referenced by visible assignments, including deleted historical groups.
        var groupIds=sources.values().stream().flatMap(Set::stream).distinct().toList();
        Map<Long,Map<String,Object>> groups=new HashMap<>();
        if(!groupIds.isEmpty()) {
            String groupPlaceholders=String.join(",",Collections.nCopies(groupIds.size(),"?"));
            for(var group:db.rows("SELECT id,name FROM learning_groups WHERE id IN ("+groupPlaceholders+")",groupIds.toArray())) groups.put(number(group,"id"),group);
        }
        for(var assignment:assignments) {
            long id=number(assignment,"id");
            var assignedGroups=sources.getOrDefault(id,Set.of()).stream()
                    .map(group->groups.getOrDefault(group,Map.of("id",group,"name","Група #"+group)))
                    .sorted(Comparator.comparing(group->string(group,"name"))).toList();
            assignment.put("recipient_groups",assignedGroups);
            assignment.put("individual_recipients",individuals.getOrDefault(id,List.of()));
        }
        return assignments;
    }
    @Transactional
    public Map<String,Object> create(OrgAccess.Scope scope,AssignmentRequest request) {
        if(request.groupIds()==null || request.groupIds().isEmpty() || request.groupIds().stream().anyMatch(id->id==null || id<1) || request.studentIds()!=null && !request.studentIds().isEmpty())
            throw WorkspaceError.validation("Тестът може да се възлага само на групи. Изберете поне една група.");
        if(!scope.platform()) organizations.requirePaid(scope.organizationId());
        if(request.startsAt()==null || request.endsAt()==null || !request.startsAt().isBefore(request.endsAt()) || !clock.instant().isBefore(request.endsAt()) || request.maxAttempts()<1 || request.maxAttempts()>20) throw WorkspaceError.validation("Невалиден период или брой опити.");
        var version=db.one("SELECT v.*,t.owner_id,t.shared,t.status FROM assessment_versions v JOIN workspace_assessments t ON t.organization_id=v.organization_id AND t.id=v.assessment_id WHERE v.organization_id=? AND v.id=?",scope.organizationId(),request.versionId());
        if(!flag(version,"shared") && number(version,"owner_id")!=scope.userId() || string(version,"status").equals("archived")) throw WorkspaceError.forbidden();
        if(scope.platform()) organizations.requireActiveMember(scope,scope.userId(),"TEACHER");
        Map<Long,Set<Long>> recipients=new LinkedHashMap<>();
        for(Long group:new LinkedHashSet<>(request.groupIds())) {
            long groupWorkspace=number(organizations.groupAccess(scope,group),"organization_id");
            var members=db.rows("SELECT g.user_id FROM group_members g JOIN memberships m ON m.organization_id=g.organization_id AND m.user_id=g.user_id JOIN users u ON u.id=g.user_id WHERE g.organization_id=? AND g.group_id=? AND g.active=TRUE AND m.status='active' AND m.roles_json LIKE '%STUDENT%' AND u.active=TRUE AND u.role='STUDENT'",groupWorkspace,group);
            if(members.isEmpty()) throw WorkspaceError.validation("Групата няма активни ученици.");
            for(var member:members) {long user=number(member,"user_id");organizations.requireActiveMember(scope,user,"STUDENT");recipients.computeIfAbsent(user,key->new LinkedHashSet<>()).add(group);}
        }
        if(recipients.isEmpty()) throw WorkspaceError.validation("Изберете поне един получател.");
        long id=db.insert("INSERT INTO exam_assignments(organization_id,version_id,teacher_id,starts_at,ends_at,max_attempts,shuffle_questions,shuffle_options,answers_after_deadline,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",scope.organizationId(),request.versionId(),scope.userId(),request.startsAt(),request.endsAt(),request.maxAttempts(),request.shuffleQuestions(),request.shuffleOptions(),request.answersAfterDeadline(),clock.instant());
        for(var recipient:recipients.entrySet()) db.update("INSERT INTO assignment_recipients(organization_id,assignment_id,student_id,source_groups_json,individually_assigned,max_attempts) VALUES(?,?,?,?,FALSE,?)",scope.organizationId(),id,recipient.getKey(),db.json(recipient.getValue()),request.maxAttempts());
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
    public void remove(OrgAccess.Scope scope,long id) {
        var assignment=teacherAccess(scope,id,false);
        if(number(assignment,"teacher_id")!=scope.userId()) throw WorkspaceError.forbidden();
        // Match exam-start/code-delivery lock order before preventing new recipients.
        db.rows("SELECT student_id FROM assignment_recipients WHERE organization_id=? AND assignment_id=? ORDER BY student_id FOR UPDATE",scope.organizationId(),id);
        teacherAccess(scope,id,true);
        var attempts=db.rows("SELECT id FROM exam_attempts WHERE organization_id=? AND assignment_id=? ORDER BY id FOR UPDATE",scope.organizationId(),id);
        for(var attempt:attempts) {
            long attemptId=number(attempt,"id");
            var deliveries=db.rows("SELECT n.id,n.status FROM notification_outbox n JOIN result_revisions r ON r.organization_id=n.organization_id AND r.id=n.revision_id WHERE r.organization_id=? AND r.attempt_id=? FOR UPDATE",scope.organizationId(),attemptId);
            if(deliveries.stream().anyMatch(n->string(n,"status").equals("processing"))) throw WorkspaceError.conflict("Изчакайте текущата доставка на резултат и опитайте отново.");
            db.update("DELETE FROM notification_outbox WHERE organization_id=? AND revision_id IN (SELECT id FROM result_revisions WHERE organization_id=? AND attempt_id=?)",scope.organizationId(),scope.organizationId(),attemptId);
            db.update("DELETE FROM exam_events WHERE organization_id=? AND attempt_id=?",scope.organizationId(),attemptId);
            db.update("DELETE FROM result_revisions WHERE organization_id=? AND attempt_id=?",scope.organizationId(),attemptId);
            db.update("DELETE FROM attempt_questions WHERE organization_id=? AND attempt_id=?",scope.organizationId(),attemptId);
            db.update("DELETE FROM exam_attempts WHERE organization_id=? AND id=?",scope.organizationId(),attemptId);
        }
        db.update("DELETE FROM assignment_code_deliveries WHERE organization_id=? AND assignment_id=?",scope.organizationId(),id);
        db.update("DELETE FROM assignment_teachers WHERE organization_id=? AND assignment_id=?",scope.organizationId(),id);
        db.update("DELETE FROM assignment_recipients WHERE organization_id=? AND assignment_id=?",scope.organizationId(),id);
        db.update("DELETE FROM exam_assignments WHERE organization_id=? AND id=?",scope.organizationId(),id);
        audit.write(scope.organizationId(),scope.userId(),"assignment.deleted",id,Map.of("attempts",attempts.size(),"version",number(assignment,"version_id")));
    }
    @Transactional
    public void accommodate(OrgAccess.Scope scope,long id,long user,Accommodation request) {
        teacherAccess(scope,id,false);
        if(request.reason()==null || request.reason().isBlank() || request.timeMultiplier()==null || request.timeMultiplier().compareTo(BigDecimal.ONE)<0 || request.timeMultiplier().compareTo(new BigDecimal("5"))>0 || request.maxAttempts()<1) throw WorkspaceError.validation("Изключението изисква причина, време 1–5 и валиден брой опити.");
        var recipient=db.one("SELECT * FROM assignment_recipients WHERE organization_id=? AND assignment_id=? AND student_id=? FOR UPDATE",scope.organizationId(),id,user);
        if(request.maxAttempts()>Math.max(20,number(recipient,"max_attempts"))) throw WorkspaceError.validation("Невалиден брой опити.");
        teacherAccess(scope,id,true);
        if(db.count("SELECT COUNT(*) FROM exam_attempts WHERE organization_id=? AND assignment_id=? AND student_id=? AND status='in_progress'",scope.organizationId(),id,user)>0) throw WorkspaceError.conflict("Изключенията не променят активен опит.");
        db.update("UPDATE assignment_recipients SET fullscreen_exempt=?,time_multiplier=?,max_attempts=?,accommodation_reason=? WHERE organization_id=? AND assignment_id=? AND student_id=?",request.fullscreenExempt(),request.timeMultiplier(),request.maxAttempts(),request.reason(),scope.organizationId(),id,user);
        audit.write(scope.organizationId(),scope.userId(),"assignment.accommodation",id,Map.of("student",user,"reason",request.reason(),"fullscreenExempt",request.fullscreenExempt(),"timeMultiplier",request.timeMultiplier(),"maxAttempts",request.maxAttempts()));
    }
    public List<Map<String,Object>> monitoring(OrgAccess.Scope scope,long id) {
        teacherAccess(scope,id,false);
        return db.rows("SELECT r.student_id,u.name,u.email,r.canceled,r.max_attempts,r.fullscreen_exempt,r.time_multiplier,r.accommodation_reason,a.id attempt_id,a.attempt_number,a.status,a.current_position,a.started_at,a.submitted_at FROM assignment_recipients r JOIN users u ON u.id=r.student_id LEFT JOIN exam_attempts a ON a.organization_id=r.organization_id AND a.assignment_id=r.assignment_id AND a.student_id=r.student_id WHERE r.organization_id=? AND r.assignment_id=? ORDER BY u.name,a.attempt_number DESC",scope.organizationId(),id);
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
    @Transactional(readOnly=true)
    public List<Map<String,Object>> groupMembers(OrgAccess.Scope scope,long id) {
        teacherAccess(scope,id,false);
        var recipients=db.rows("SELECT source_groups_json FROM assignment_recipients WHERE organization_id=? AND assignment_id=?",scope.organizationId(),id);
        Map<Long,Map<String,Object>> members=new LinkedHashMap<>();
        for(var member:eligibleMembers(sourceGroupIds(recipients),null)) members.putIfAbsent(number(member,"student_id"),Map.of("student_id",number(member,"student_id"),"name",string(member,"name"),"email",string(member,"email")));
        return new ArrayList<>(members.values());
    }
    @Transactional public void addRecipient(OrgAccess.Scope scope,long id,long student) {
        teacherAccess(scope,id,false);
        if(!scope.platform()) organizations.requirePaid(scope.organizationId());
        organizations.requireActiveMember(scope,student,"STUDENT");
        var recipients=db.rows("SELECT * FROM assignment_recipients WHERE organization_id=? AND assignment_id=? ORDER BY student_id FOR UPDATE",scope.organizationId(),id);
        var assignment=teacherAccess(scope,id,true);
        if(!clock.instant().isBefore(time(assignment,"ends_at"))) throw WorkspaceError.expired("Срокът за това възлагане е изтекъл.");
        var sources=eligibleMembers(sourceGroupIds(recipients),student).stream().map(row->number(row,"group_id")).distinct().toList();
        if(sources.isEmpty()) throw WorkspaceError.forbidden();
        var previous=recipients.stream().filter(row->number(row,"student_id")==student).findFirst();
        long maxAttempts=number(assignment,"max_attempts");
        if(previous.isPresent()) {
            var row=previous.get();
            var attempts=db.rows("SELECT id,status FROM exam_attempts WHERE organization_id=? AND assignment_id=? AND student_id=? ORDER BY id FOR UPDATE",scope.organizationId(),id,student);
            if(attempts.stream().anyMatch(attempt->string(attempt,"status").equals("in_progress"))) throw WorkspaceError.conflict("Ученикът има активен опит. Изчакайте приключването му.");
            maxAttempts=Math.max(number(row,"max_attempts"),attempts.size()+1L);
            if(!flag(row,"canceled") && maxAttempts==number(row,"max_attempts")) return;
            db.update("UPDATE assignment_recipients SET canceled=FALSE,max_attempts=? WHERE organization_id=? AND assignment_id=? AND student_id=?",maxAttempts,scope.organizationId(),id,student);
        } else {
            db.update("INSERT INTO assignment_recipients(organization_id,assignment_id,student_id,source_groups_json,individually_assigned,max_attempts) VALUES(?,?,?,?,FALSE,?)",scope.organizationId(),id,student,db.json(sources),maxAttempts);
        }
        audit.write(scope.organizationId(),scope.userId(),"assignment.recipient_assigned",id,Map.of("student",student,"maxAttempts",maxAttempts));
    }
    @Transactional public void removeRecipient(OrgAccess.Scope scope,long id,long student) {
        teacherAccess(scope,id,false);
        var recipients=db.rows("SELECT student_id,source_groups_json,canceled FROM assignment_recipients WHERE organization_id=? AND assignment_id=? ORDER BY student_id FOR UPDATE",scope.organizationId(),id);
        teacherAccess(scope,id,true);
        if(sourceGroupIds(recipients).isEmpty()) throw WorkspaceError.conflict("Управлението на членове е достъпно само за групово възлагане.");
        var recipient=recipients.stream().filter(row->number(row,"student_id")==student).findFirst().orElseThrow(WorkspaceError::notFound);
        if(flag(recipient,"canceled")) return;
        // Preserve answers and published results; only unfinished attempts lose their active session.
        var attempts=db.rows("SELECT id FROM exam_attempts WHERE organization_id=? AND assignment_id=? AND student_id=? AND status='in_progress' FOR UPDATE",scope.organizationId(),id,student);
        String reason="Възлагането е премахнато за ученика.";
        for(var attempt:attempts) {
            long attemptId=number(attempt,"id");
            db.update("UPDATE exam_attempts SET status='voided',active_key=NULL,submitted_at=?,void_reason=? WHERE organization_id=? AND id=?",clock.instant(),reason,scope.organizationId(),attemptId);
            audit.write(scope.organizationId(),scope.userId(),"attempt.voided",attemptId,Map.of("reason",reason));
        }
        db.update("UPDATE assignment_recipients SET canceled=TRUE WHERE organization_id=? AND assignment_id=? AND student_id=?",scope.organizationId(),id,student);
        audit.write(scope.organizationId(),scope.userId(),"assignment.recipient_removed",id,Map.of("student",student));
    }
    private Set<Long> sourceGroupIds(List<Map<String,Object>> recipients) {
        Set<Long> groups=new LinkedHashSet<>();
        for(var recipient:recipients) groups.addAll(Arrays.asList(db.parse(recipient.get("source_groups_json"),Long[].class)));
        return groups;
    }
    private List<Map<String,Object>> eligibleMembers(Set<Long> groups,Long student) {
        if(groups.isEmpty()) return List.of();
        String placeholders=String.join(",",Collections.nCopies(groups.size(),"?"));
        List<Object> args=new ArrayList<>(groups);
        if(student!=null) args.add(student);
        return db.rows("SELECT DISTINCT g.id group_id,u.id student_id,u.name,u.email FROM learning_groups g JOIN group_members gm ON gm.organization_id=g.organization_id AND gm.group_id=g.id JOIN memberships m ON m.organization_id=gm.organization_id AND m.user_id=gm.user_id JOIN users u ON u.id=gm.user_id WHERE g.id IN ("+placeholders+") AND g.deleted_at IS NULL AND gm.active=TRUE AND m.status='active' AND m.roles_json LIKE '%STUDENT%' AND u.active=TRUE AND u.role='STUDENT'"+(student==null?"":" AND u.id=?")+" ORDER BY u.name,u.id,g.id",args.toArray());
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
