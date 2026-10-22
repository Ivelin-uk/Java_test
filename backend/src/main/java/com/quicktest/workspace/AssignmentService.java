package com.quicktest.workspace;

import com.quicktest.workspace.repository.AssignmentRepository;
import jakarta.validation.constraints.NotNull;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Isolation;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.util.*;
import static com.quicktest.workspace.WorkspaceValues.*;

@Service
public class AssignmentService {
    private final WorkspaceJson json;
    private final AssignmentRepository repository;
    private final OrganizationService organizations;
    private final WorkspaceCrypto crypto;
    private final WorkspaceAudit audit;
    private final CodeRateLimiter codeLimiter;
    private final Clock clock;private final NotificationService notifications;private final boolean mobileValidated;
    public AssignmentService(AssignmentRepository repository,WorkspaceJson json,OrganizationService organizations,WorkspaceCrypto crypto,WorkspaceAudit audit,Clock clock,NotificationService notifications,CodeRateLimiter codeLimiter,@org.springframework.beans.factory.annotation.Value("${app.exam.mobile-validated:false}") boolean mobileValidated) {this.repository=repository;this.json=json;this.organizations=organizations;this.crypto=crypto;this.audit=audit;this.clock=clock;this.notifications=notifications;this.codeLimiter=codeLimiter;this.mobileValidated=mobileValidated;}
    public Map<String,Object> teacherAccess(OrgAccess.Scope scope,long id,boolean lock) {
        var assignment=repository.findAssignment(scope.organizationId(), id, lock);
        if(number(assignment,"teacher_id")!=scope.userId() && repository.countSharedTeacher(scope.organizationId(), id, scope.userId())==0) throw WorkspaceError.forbidden();
        return assignment;
    }
    @Transactional(readOnly=true)
    public List<Map<String,Object>> list(OrgAccess.Scope scope) {
        if(scope.roles().contains("TEACHER")) return teacherList(scope);
        return repository.findStudentAssignments(scope.organizationId(), scope.platform(), scope.userId());
    }
    public Map<String,Object> resolveCode(OrgAccess.Scope scope,String code,String ip) {
        if(!scope.roles().contains("STUDENT")) throw WorkspaceError.forbidden();
        String normalized=code==null?"":code.strip().toUpperCase(Locale.ROOT);
        if(!normalized.matches("[A-Z0-9]{8}")) throw WorkspaceError.validation("Невалиден или отменен код.");
        var matches=repository.findStudentCodeCandidates(scope.organizationId(),scope.platform(),scope.userId()).stream()
                .filter(row->crypto.matches(number(row,"organization_id")+":"+number(row,"id")+":"+normalized,string(row,"code_hash"))).toList();
        // Commit guess accounting independently, just as exam start does.
        if(!codeLimiter.checkAssignmentLookup(scope.userId(),ip,!matches.isEmpty())) throw codeLimiter.limited();
        if(matches.isEmpty()) throw WorkspaceError.validation("Невалиден или отменен код.");
        if(matches.size()>1) throw WorkspaceError.conflict("Кодът съвпада с повече от едно възлагане. Поискайте отделен код от учителя.");
        var match=matches.getFirst();
        return Map.of("id",number(match,"id"),"title",string(match,"title"));
    }
    @Transactional(readOnly=true)
    public List<Map<String,Object>> listStudentGroup(OrgAccess.Scope scope,long group) {
        organizations.requireStudentGroup(scope,group);
        var assignments=repository.findStudentAssignments(scope.organizationId(),scope.platform(),scope.userId(),true);
        return assignments.stream().filter(row->Arrays.asList(json.parse(row.get("source_groups_json"),Long[].class)).contains(group))
                .peek(row->row.remove("source_groups_json")).toList();
    }
    private List<Map<String,Object>> teacherList(OrgAccess.Scope scope) {
        var assignments=repository.findTeacherAssignments(scope.organizationId(), scope.platform(), scope.userId(), scope.userId());
        if(assignments.isEmpty()) return assignments;
        var ids=assignments.stream().map(a->number(a,"id")).toList();
        var recipients=repository.findRecipientSources(ids);
        Map<Long,Set<Long>> sources=new HashMap<>();
        Map<Long,List<Map<String,Object>>> individuals=new HashMap<>();
        for(var recipient:recipients) {
            long id=number(recipient,"assignment_id");
            sources.computeIfAbsent(id,key->new LinkedHashSet<>()).addAll(Arrays.asList(json.parse(recipient.get("source_groups_json"),Long[].class)));
            if(flag(recipient,"individually_assigned")) individuals.computeIfAbsent(id,key->new ArrayList<>()).add(Map.of("id",number(recipient,"student_id"),"name",string(recipient,"name")));
        }
        // Resolve only groups referenced by visible assignments, including deleted historical groups.
        var groupIds=sources.values().stream().flatMap(Set::stream).distinct().toList();
        Map<Long,Map<String,Object>> groups=new HashMap<>();
        if(!groupIds.isEmpty()) {
            for(var group:repository.findGroupNames(groupIds)) groups.put(number(group,"id"),group);
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
    @Transactional(isolation=Isolation.READ_COMMITTED)
    public Map<String,Object> create(OrgAccess.Scope scope,AssignmentRequest request) {
        if(request.groupIds()==null || request.groupIds().isEmpty() || request.groupIds().stream().anyMatch(id->id==null || id<1) || request.studentIds()!=null && !request.studentIds().isEmpty())
            throw WorkspaceError.validation("Тестът може да се възлага само на групи. Изберете поне една група.");
        if(!scope.platform()) organizations.requirePaid(scope.organizationId());
        if(request.startsAt()==null || request.endsAt()==null || !request.startsAt().isBefore(request.endsAt()) || !clock.instant().isBefore(request.endsAt()) || request.maxAttempts()<1 || request.maxAttempts()>20) throw WorkspaceError.validation("Невалиден период или брой опити.");
        var version=repository.requireAssignableVersion(scope.organizationId(), request.versionId());
        if(!flag(version,"shared") && number(version,"owner_id")!=scope.userId() || string(version,"status").equals("archived")) throw WorkspaceError.forbidden();
        if(scope.platform()) organizations.requireActiveMember(scope,scope.userId(),"TEACHER");
        // READ_COMMITTED plus ordered group locks makes a concurrent join visible
        // after waiting; an earlier version lookup must not freeze the member snapshot.
        Map<Long,Long> assignedGroups=new LinkedHashMap<>();
        for(Long group:new TreeSet<>(request.groupIds())) assignedGroups.put(group,number(organizations.lockAssignmentGroup(scope,group),"organization_id"));
        Map<Long,Set<Long>> recipients=new LinkedHashMap<>();
        for(var entry:assignedGroups.entrySet()) {
            Long group=entry.getKey();long groupWorkspace=entry.getValue();
            var members=repository.findActiveGroupStudents(groupWorkspace, group);
            if(members.isEmpty()) throw WorkspaceError.validation("Групата няма активни ученици.");
            for(var member:members) {long user=number(member,"user_id");organizations.requireActiveMember(scope,user,"STUDENT");recipients.computeIfAbsent(user,key->new LinkedHashSet<>()).add(group);}
        }
        if(recipients.isEmpty()) throw WorkspaceError.validation("Изберете поне един получател.");
        long id=repository.insertAssignment(scope.organizationId(), request.versionId(), scope.userId(), request.startsAt(), request.endsAt(), request.maxAttempts(), request.shuffleQuestions(), request.shuffleOptions(), request.answersAfterDeadline(), clock.instant());
        for(var entry:assignedGroups.entrySet()) repository.insertAssignmentGroup(scope.organizationId(),id,entry.getValue(),entry.getKey());
        for(var recipient:recipients.entrySet()) repository.insertRecipient(scope.organizationId(), id, recipient.getKey(), json.write(recipient.getValue()), request.maxAttempts());
        String code=crypto.code();repository.saveCode(codeHash(scope.organizationId(),id,code), code, id, scope.organizationId());
        audit.write(scope.organizationId(),scope.userId(),"assignment.created",id,Map.of("recipients",recipients.size(),"version",request.versionId()));
        return Map.of("id",id,"code",code,"recipients",recipients.size());
    }
    public String codeHash(long org,long assignment,String code) {return crypto.hash(org+":"+assignment+":"+code.strip().toUpperCase(Locale.ROOT));}
    public record ScheduleRequest(@NotNull Instant startsAt,@NotNull Instant endsAt) {}
    @Transactional
    public void updateSchedule(OrgAccess.Scope scope,long id,ScheduleRequest request) {
        teacherAccess(scope,id,false);
        if(request.startsAt()==null || request.endsAt()==null || !request.startsAt().isBefore(request.endsAt()))
            throw WorkspaceError.validation("Крайният срок трябва да е след началото.");
        if(!clock.instant().isBefore(request.endsAt())) throw WorkspaceError.validation("Крайният срок трябва да е в бъдещето.");
        // Serialize with exam start using recipient -> assignment -> attempt lock order.
        repository.lockRecipientIds(scope.organizationId(),id);
        var assignment=teacherAccess(scope,id,true);
        Instant previousStart=time(assignment,"starts_at"),previousEnd=time(assignment,"ends_at");
        if(previousStart.equals(request.startsAt()) && previousEnd.equals(request.endsAt())) return;
        if(!repository.lockActiveAttempts(scope.organizationId(),id).isEmpty())
            throw WorkspaceError.conflict("Има активни опити. Изчакайте приключването им, преди да промените датите.");
        repository.updateSchedule(scope.organizationId(),id,request.startsAt(),request.endsAt());
        audit.write(scope.organizationId(),scope.userId(),"assignment.schedule_updated",id,Map.of(
                "previousStartsAt",previousStart.toString(),"previousEndsAt",previousEnd.toString(),
                "startsAt",request.startsAt().toString(),"endsAt",request.endsAt().toString()));
    }
    @Transactional
    public Map<String,Object> rotate(OrgAccess.Scope scope,long id) {
        teacherAccess(scope,id,true);String code=crypto.code();
        repository.rotateCode(codeHash(scope.organizationId(),id,code), code, scope.organizationId(), id);
        audit.write(scope.organizationId(),scope.userId(),"assignment.code_rotated",id,Map.of());
        return Map.of("code",code);
    }
    @Transactional
    public void revoke(OrgAccess.Scope scope,long id) {
        teacherAccess(scope,id,true);repository.revokeCode(scope.organizationId(), id);
        audit.write(scope.organizationId(),scope.userId(),"assignment.code_revoked",id,Map.of());
    }
    @Transactional
    public void remove(OrgAccess.Scope scope,long id) {
        var assignment=teacherAccess(scope,id,false);
        if(number(assignment,"teacher_id")!=scope.userId()) throw WorkspaceError.forbidden();
        // Match exam-start/code-delivery lock order before preventing new recipients.
        repository.lockRecipientIds(scope.organizationId(), id);
        teacherAccess(scope,id,true);
        var attempts=repository.lockAttemptIds(scope.organizationId(), id);
        for(var attempt:attempts) {
            long attemptId=number(attempt,"id");
            var deliveries=repository.lockResultDeliveries(scope.organizationId(), attemptId);
            if(deliveries.stream().anyMatch(n->string(n,"status").equals("processing"))) throw WorkspaceError.conflict("Изчакайте текущата доставка на резултат и опитайте отново.");
            repository.deleteResultDeliveries(scope.organizationId(), scope.organizationId(), attemptId);
            repository.deleteEvents(scope.organizationId(), attemptId);
            repository.deleteResults(scope.organizationId(), attemptId);
            repository.deleteQuestions(scope.organizationId(), attemptId);
            repository.deleteAttempt(scope.organizationId(), attemptId);
        }
        repository.deleteCodeDeliveries(scope.organizationId(), id);
        repository.deleteSharedTeachers(scope.organizationId(), id);
        repository.deleteRecipients(scope.organizationId(), id);
        repository.deleteAssignment(scope.organizationId(), id);
        audit.write(scope.organizationId(),scope.userId(),"assignment.deleted",id,Map.of("attempts",attempts.size(),"version",number(assignment,"version_id")));
    }
    @Transactional
    public void accommodate(OrgAccess.Scope scope,long id,long user,Accommodation request) {
        teacherAccess(scope,id,false);
        if(request.reason()==null || request.reason().isBlank() || request.timeMultiplier()==null || request.timeMultiplier().compareTo(BigDecimal.ONE)<0 || request.timeMultiplier().compareTo(new BigDecimal("5"))>0 || request.maxAttempts()<1) throw WorkspaceError.validation("Изключението изисква причина, време 1–5 и валиден брой опити.");
        var recipient=repository.lockRecipient(scope.organizationId(), id, user);
        if(request.maxAttempts()>Math.max(20,number(recipient,"max_attempts"))) throw WorkspaceError.validation("Невалиден брой опити.");
        teacherAccess(scope,id,true);
        if(repository.countActiveAttempts(scope.organizationId(), id, user)>0) throw WorkspaceError.conflict("Изключенията не променят активен опит.");
        repository.updateAccommodation(request.fullscreenExempt(), request.timeMultiplier(), request.maxAttempts(), request.reason(), scope.organizationId(), id, user);
        audit.write(scope.organizationId(),scope.userId(),"assignment.accommodation",id,Map.of("student",user,"reason",request.reason(),"fullscreenExempt",request.fullscreenExempt(),"timeMultiplier",request.timeMultiplier(),"maxAttempts",request.maxAttempts()));
    }
    public List<Map<String,Object>> monitoring(OrgAccess.Scope scope,long id) {
        teacherAccess(scope,id,false);
        return repository.findMonitoringRows(scope.organizationId(), id);
    }
    @Transactional
    public Map<String,Object> allowExtraAttempt(OrgAccess.Scope scope,long id,long student) {
        teacherAccess(scope,id,false);
        // Use the same recipient -> assignment -> attempt lock order as exam start.
        var recipient=repository.lockRecipient(scope.organizationId(),id,student);
        var assignment=teacherAccess(scope,id,true);
        if(flag(recipient,"canceled")) throw WorkspaceError.conflict("Възлагането за ученика е премахнато.");
        if(!clock.instant().isBefore(time(assignment,"ends_at"))) throw WorkspaceError.expired("Срокът на теста е изтекъл. Допълнителен опит не може да бъде започнат.");
        var groups=sourceGroupIds(List.of(recipient));
        if(groups.isEmpty() || eligibleMembers(groups,student).isEmpty()) throw WorkspaceError.forbidden();
        organizations.requireActiveMember(scope,student,"STUDENT");
        var attempts=repository.lockStudentAttempts(scope.organizationId(),id,student);
        if(attempts.stream().anyMatch(attempt->string(attempt,"status").equals("in_progress"))) throw WorkspaceError.conflict("Ученикът има активен опит. Изчакайте приключването му.");
        long previous=number(recipient,"max_attempts"),allowed=Math.max(previous,attempts.size()+1L);
        // Concurrent or repeated requests leave exactly one unused attempt.
        if(allowed>previous) {
            repository.setMaxAttempts(allowed,scope.organizationId(),id,student);
            audit.write(scope.organizationId(),scope.userId(),"assignment.extra_attempt_allowed",id,Map.of("student",student,"maxAttempts",allowed));
        }
        return Map.of("maxAttempts",allowed,"remainingAttempts",allowed-attempts.size(),"granted",allowed>previous);
    }
    public Map<String,Object> preflight(OrgAccess.Scope scope,long id) {
        var row=repository.findPreflight(scope.organizationId(), id, scope.userId());
        if(flag(row,"canceled")) throw WorkspaceError.forbidden();
        AssessmentService.Definition definition=json.parse(row.remove("definition_json"),AssessmentService.Definition.class);
        row.put("mobile_validated",mobileValidated);row.put("instructions",definition.instructions());row.put("question_count",definition.questions().size());
        row.put("total_seconds",definition.questions().stream().mapToLong(q->(long)Math.ceil(q.timeSeconds()*decimal(row,"time_multiplier").doubleValue())).sum());
        return row;
    }
    @Transactional public void shareTeacher(OrgAccess.Scope scope,long id,long teacher,boolean shared) {
        var assignment=teacherAccess(scope,id,true);if(number(assignment,"teacher_id")!=scope.userId()) throw WorkspaceError.forbidden();organizations.requireActiveMember(scope,teacher,"TEACHER");
        if(shared) repository.shareTeacher(scope.organizationId(), id, teacher);
        else repository.unshareTeacher(scope.organizationId(), id, teacher);
        audit.write(scope.organizationId(),scope.userId(),"assignment.teacher_access_changed",id,Map.of("teacher",teacher,"shared",shared));
    }
    public Object sharedTeachers(OrgAccess.Scope scope,long id) {teacherAccess(scope,id,false);return repository.findSharedTeachers(scope.organizationId(), id);}
    @Transactional(readOnly=true)
    public List<Map<String,Object>> groupMembers(OrgAccess.Scope scope,long id) {
        teacherAccess(scope,id,false);
        var recipients=repository.findSourceGroups(scope.organizationId(), id);
        Map<Long,Map<String,Object>> members=new LinkedHashMap<>();
        for(var member:eligibleMembers(sourceGroupIds(recipients),null)) members.putIfAbsent(number(member,"student_id"),Map.of("student_id",number(member,"student_id"),"name",string(member,"name"),"email",string(member,"email")));
        return new ArrayList<>(members.values());
    }
    @Transactional public void addRecipient(OrgAccess.Scope scope,long id,long student) {
        teacherAccess(scope,id,false);
        if(!scope.platform()) organizations.requirePaid(scope.organizationId());
        organizations.requireActiveMember(scope,student,"STUDENT");
        var recipients=repository.lockRecipients(scope.organizationId(), id);
        var assignment=teacherAccess(scope,id,true);
        if(!clock.instant().isBefore(time(assignment,"ends_at"))) throw WorkspaceError.expired("Срокът за това възлагане е изтекъл.");
        var sources=eligibleMembers(sourceGroupIds(recipients),student).stream().map(row->number(row,"group_id")).distinct().toList();
        if(sources.isEmpty()) throw WorkspaceError.forbidden();
        var previous=recipients.stream().filter(row->number(row,"student_id")==student).findFirst();
        long maxAttempts=number(assignment,"max_attempts");
        if(previous.isPresent()) {
            var row=previous.get();
            var attempts=repository.lockStudentAttempts(scope.organizationId(), id, student);
            if(attempts.stream().anyMatch(attempt->string(attempt,"status").equals("in_progress"))) throw WorkspaceError.conflict("Ученикът има активен опит. Изчакайте приключването му.");
            maxAttempts=Math.max(number(row,"max_attempts"),attempts.size()+1L);
            if(!flag(row,"canceled") && maxAttempts==number(row,"max_attempts")) return;
            repository.restoreRecipient(maxAttempts, scope.organizationId(), id, student);
        } else {
            repository.insertRecipient(scope.organizationId(), id, student, json.write(sources), maxAttempts);
        }
        audit.write(scope.organizationId(),scope.userId(),"assignment.recipient_assigned",id,Map.of("student",student,"maxAttempts",maxAttempts));
    }
    @Transactional public void removeRecipient(OrgAccess.Scope scope,long id,long student) {
        teacherAccess(scope,id,false);
        var recipients=repository.findRecipientAccess(scope.organizationId(), id);
        teacherAccess(scope,id,true);
        if(sourceGroupIds(recipients).isEmpty()) throw WorkspaceError.conflict("Управлението на членове е достъпно само за групово възлагане.");
        var recipient=recipients.stream().filter(row->number(row,"student_id")==student).findFirst().orElseThrow(WorkspaceError::notFound);
        if(flag(recipient,"canceled")) return;
        // Preserve answers and published results; only unfinished attempts lose their active session.
        var attempts=repository.lockActiveStudentAttempts(scope.organizationId(), id, student);
        String reason="Възлагането е премахнато за ученика.";
        for(var attempt:attempts) {
            long attemptId=number(attempt,"id");
            repository.voidAttempt(clock.instant(), reason, scope.organizationId(), attemptId);
            audit.write(scope.organizationId(),scope.userId(),"attempt.voided",attemptId,Map.of("reason",reason));
        }
        repository.cancelRecipient(scope.organizationId(), id, student);
        audit.write(scope.organizationId(),scope.userId(),"assignment.recipient_removed",id,Map.of("student",student));
    }
    private Set<Long> sourceGroupIds(List<Map<String,Object>> recipients) {
        Set<Long> groups=new LinkedHashSet<>();
        for(var recipient:recipients) groups.addAll(Arrays.asList(json.parse(recipient.get("source_groups_json"),Long[].class)));
        return groups;
    }
    private List<Map<String,Object>> eligibleMembers(Set<Long> groups,Long student) {
        return repository.findEligibleMembers(groups, student);
    }
    public record AssignmentRequest(long versionId,List<Long> groupIds,List<Long> studentIds,Instant startsAt,Instant endsAt,int maxAttempts,boolean shuffleQuestions,boolean shuffleOptions,boolean answersAfterDeadline) {}
    public record Accommodation(boolean fullscreenExempt,BigDecimal timeMultiplier,int maxAttempts,String reason) {}
    @Transactional public Object dispatchCode(OrgAccess.Scope scope,long id,CodeDelivery request) {
        teacherAccess(scope,id,false);
        // Start and accommodation also lock recipients before their assignment parent.
        repository.lockRecipientIds(scope.organizationId(), id);
        var assignment=teacherAccess(scope,id,true);
        if(request.code()==null || !"email".equals(request.channel()) || !codeHash(scope.organizationId(),id,request.code()).equals(string(assignment,"code_hash"))) throw WorkspaceError.validation("Невалиден или отменен код.");
        int sent=0;var organization=repository.requireOrganizationName(scope.organizationId());
        for(var recipient:repository.findActiveRecipientIds(scope.organizationId(), id)) {
            long student=number(recipient,"student_id");
            if(repository.countCodeDeliveries(scope.organizationId(), id, number(assignment,"code_generation"), student, request.channel())>0) continue;
            notifications.enqueue(scope.organizationId(),null,student,"assignment_code",notifications.verifiedAddress(student),Map.of("code",request.code().strip().toUpperCase(Locale.ROOT),"test",string(assignment,"title"),"organization",scope.platform()?"ExamAI":string(organization,"name")));
            repository.recordCodeDelivery(scope.organizationId(), id, number(assignment,"code_generation"), student, request.channel(), clock.instant());sent++;
        }
        audit.write(scope.organizationId(),scope.userId(),"assignment.code_dispatched",id,Map.of("channel",request.channel(),"recipients",sent));return Map.of("queued",sent);
    }
    public record CodeDelivery(String code,String channel) {}
}
