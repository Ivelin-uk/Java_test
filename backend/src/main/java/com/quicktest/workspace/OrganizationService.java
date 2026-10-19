package com.quicktest.workspace;

import com.quicktest.workspace.repository.OrganizationRepository;

import jakarta.validation.constraints.*;
import org.apache.commons.csv.CSVFormat;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.StringReader;
import java.time.Clock;
import java.time.Duration;
import java.time.ZoneId;
import java.util.*;
import static com.quicktest.workspace.WorkspaceValues.*;

@Service
public class OrganizationService {
    private final WorkspaceJson json;
    private final OrganizationRepository repository;
    private final WorkspaceCrypto crypto;
    private final WorkspaceAudit audit;
    private final NotificationService notifications;
    private final Clock clock;
    private final PersonalWorkspace personal;
    private final CodeRateLimiter codeLimiter;

    public OrganizationService(OrganizationRepository repository,WorkspaceJson json, WorkspaceCrypto crypto, WorkspaceAudit audit, NotificationService notifications, Clock clock, PersonalWorkspace personal,CodeRateLimiter codeLimiter) {
        this.repository = repository;this.json=json; this.crypto = crypto; this.audit = audit; this.notifications = notifications; this.clock = clock; this.personal = personal;this.codeLimiter=codeLimiter;
    }
    public List<Map<String, Object>> organizations(long user) {
        return repository.findOrganizations(user);
    }
    @Transactional
    public Map<String, Object> create(long user, OrganizationRequest request) {
        try { ZoneId.of(request.timezone()); } catch (Exception e) { throw WorkspaceError.validation("Невалидна часова зона."); }
        long id = repository.insertOrganization(request.name().trim(), request.organizationType(), request.contactEmail(), request.timezone(), request.studentLabel(), json.write(Map.of("passThreshold",50,"gradingScale","bulgarian")), clock.instant());
        repository.insertMembership(id, user, json.write(List.of("ORG_ADMIN","TEACHER")), clock.instant());
        long plan = number(repository.requireFirstPlan(), "id");
        repository.insertTrialSubscription(id, plan, clock.instant().plus(Duration.ofDays(14)), clock.instant());
        audit.write(id,user,"organization.created",id,Map.of());
        return repository.requireOrganization(id);
    }
    public List<Map<String, Object>> members(OrgAccess.Scope scope) {
        if (!scope.roles().contains("TEACHER") && !scope.roles().contains("ORG_ADMIN")) throw WorkspaceError.forbidden();
        if(scope.platform()) return repository.findActiveProfiles().stream().map(row->{row.put("roles_json",json.write(List.of(string(row,"role"))));row.put("status","active");row.remove("role");return row;}).toList();
        return repository.findMembers(scope.organizationId());
    }
    public void requireActiveMember(long org, long user, String role) {
        var row = repository.requireActiveMembership(org, user);
        if (!Arrays.asList(json.parse(row.get("roles_json"), String[].class)).contains(role)) throw WorkspaceError.forbidden();
    }
    public void requireActiveMember(OrgAccess.Scope scope,long user,String role) {
        if(!scope.platform()) {requireActiveMember(scope.organizationId(),user,role);return;}
        repository.requireActiveProfile(user, role);
        personal.member(scope.organizationId(),user,role);
    }
    public Map<String,Object> subscription(long org) {
        return repository.requireSubscription(org);
    }
    public void requirePaid(long org) {
        var subscription = subscription(org);
        if (!List.of("active","trialing","canceled").contains(string(subscription,"status")) || !clock.instant().isBefore(time(subscription,"paid_through")))
            throw WorkspaceError.expired("Абонаментът е изтекъл. Историята и проверката остават достъпни.");
    }
    public void lockQuota(long org) {
        // Parent organization locks would conflict with membership and attempt foreign keys.
        repository.ensureQuotaLock(org);
        repository.lockQuota(org);
    }
    private List<String> roles(List<String> roles) {
        var result = roles == null ? List.<String>of() : roles.stream().distinct().sorted().toList();
        if (result.isEmpty() || !Set.of("ORG_ADMIN","TEACHER","STUDENT").containsAll(result)) throw WorkspaceError.validation("Невалидни роли.");
        return result;
    }
    private void quota(long org, List<String> requested, Long excludingUser) {
        Map<String,Object> limits = subscription(org);
        for (String role : List.of("TEACHER","STUDENT")) {
            if (!requested.contains(role)) continue;
            long members = repository.countActiveRoleMembers(org, "%\""+role+"\"%", excludingUser == null ? -1 : excludingUser);
            long reserved = repository.countPendingRoleInvitations(org, clock.instant(), "%\""+role+"\"%");
            if (members + reserved >= number(limits,role.equals("TEACHER") ? "teacher_limit" : "student_limit")) throw WorkspaceError.conflict("Изчерпан лимит за " + role + ".");
        }
    }
    @Transactional
    public Map<String,Object> invite(OrgAccess.Scope scope, InvitationRequest request) {
        List<String> requested = roles(request.roles());
        if (!scope.roles().contains("ORG_ADMIN") && (!requested.equals(List.of("STUDENT")) || request.groupId()==null)) throw WorkspaceError.forbidden();
        if (request.groupId()!=null) groupAccess(scope,request.groupId());
        lockQuota(scope.organizationId());
        String email = request.email().trim().toLowerCase(Locale.ROOT);
        if (repository.countEmailInvitations(scope.organizationId(), email, clock.instant())>0) throw WorkspaceError.conflict("Вече има активна покана за този адрес.");
        if (repository.countEmailMembers(scope.organizationId(), email)>0) throw WorkspaceError.conflict("Потребителят вече е член. Добавете го към групата от списъка.");
        quota(scope.organizationId(),requested,null);
        String token = crypto.token();
        long id = repository.insertInvitation(scope.organizationId(), email, json.write(requested), request.groupId(), crypto.hash(token), clock.instant().plus(Duration.ofDays(7)), scope.userId());
        audit.write(scope.organizationId(),scope.userId(),"invitation.created",id,Map.of("roles",requested));
        notifications.enqueue(scope.organizationId(),null,null,"invitation",email,Map.of("token",token,"organization",string(repository.requireOrganizationName(scope.organizationId()),"name"),"expires_at",clock.instant().plus(Duration.ofDays(7)).toString()));
        // The administrator may copy an invitation; the secret is never stored in audit.
        return Map.of("id",id,"token",token,"email",email,"expires_at",clock.instant().plus(Duration.ofDays(7)).toString());
    }
    @Transactional
    public Map<String,Object> accept(long user, String token) {
        var invite = repository.lockInvitation(crypto.hash(token));
        long org = number(invite,"organization_id");
        lockQuota(org);
        if (invite.get("consumed_at")!=null || !clock.instant().isBefore(time(invite,"expires_at"))) throw WorkspaceError.expired("Поканата е използвана или е изтекла.");
        var address = repository.requireNotificationAddress(user);
        if (address.get("verified_at")==null || !string(address,"email").equalsIgnoreCase(string(invite,"email"))) throw WorkspaceError.forbidden();
        repository.consumeInvitation(clock.instant(), number(invite,"id"));
        List<String> requested=Arrays.asList(json.parse(invite.get("roles_json"),String[].class));
        quota(org,requested,user);
        var existing=repository.findMembership(org, user);
        if(existing.isPresent()) repository.activateMembership(json.write(requested), org, user);
        else repository.insertMembership(org, user, json.write(requested), clock.instant());
        if(invite.get("group_id")!=null) addStudentInternal(org,number(invite,"group_id"),user);
        audit.write(org,user,"invitation.accepted",number(invite,"id"),Map.of());
        return repository.requireOrganization(org);
    }
    @Transactional
    public void changeMember(OrgAccess.Scope scope,long user,MemberChange request) {
        lockQuota(scope.organizationId());
        var current=repository.lockMembership(scope.organizationId(), user);
        List<String> roles=roles(request.roles());
        if(string(current,"roles_json").contains("ORG_ADMIN") && (!request.active() || !roles.contains("ORG_ADMIN")) && repository.countAdministrators(scope.organizationId())<=1) throw WorkspaceError.conflict("Нужен е поне един активен организационен администратор.");
        if(request.active()) {
            List<String> added=roles.stream().filter(role->!string(current,"roles_json").contains(role) || !string(current,"status").equals("active")).toList();
            quota(scope.organizationId(),added,user);
        }
        repository.updateMembership(json.write(roles), request.active()?"active":"inactive", scope.organizationId(), user);
        audit.write(scope.organizationId(),scope.userId(),"membership.changed",user,Map.of("roles",roles,"active",request.active()));
    }
    public Map<String,Object> groupAccess(OrgAccess.Scope scope,long group) {
        var row=repository.requireGroup(scope.organizationId(), scope.platform(), group);
        if(!scope.roles().contains("ORG_ADMIN") && repository.countGroupTeachers(number(row,"organization_id"), group, scope.userId())==0) throw WorkspaceError.forbidden();
        return row;
    }
    public List<Map<String,Object>> groups(OrgAccess.Scope scope) {
        if(scope.roles().contains("ORG_ADMIN")) return repository.findOrganizationGroups(scope.organizationId());
        var groups=repository.findVisibleGroups(scope.organizationId(), scope.platform(), scope.userId(), scope.userId());
        if(!scope.roles().contains("TEACHER")) groups.forEach(group->group.remove("join_code"));
        return groups;
    }
    @Transactional
    public Map<String,Object> createGroup(OrgAccess.Scope scope,GroupRequest request) {
        String code;do {code=crypto.code();} while(repository.groupCodeExists(code));
        long id=repository.insertGroup(scope.organizationId(), request.name(), request.description(), request.subject(),code, clock.instant());
        repository.insertGroupTeacher(scope.organizationId(), id, scope.userId());
        audit.write(scope.organizationId(),scope.userId(),"group.created",id,Map.of());
        return groupAccess(scope,id);
    }
    @Transactional
    public Map<String,Object> rotateGroupCode(OrgAccess.Scope scope,long group,String currentCode) {
        if(!scope.roles().contains("TEACHER")) throw WorkspaceError.forbidden();
        var row=groupAccess(scope,group);long org=number(row,"organization_id");
        if(currentCode==null || !currentCode.matches("[A-HJ-NP-Z2-9]{8}")) throw WorkspaceError.validation("Невалиден текущ код за група.");
        var locked=repository.lockGroup(org,group);
        // Repeating a request for an already replaced code returns the current one.
        if(!currentCode.equals(string(locked,"join_code"))) return Map.of("code",string(locked,"join_code"));
        String code;do {code=crypto.code();} while(repository.groupCodeExists(code));
        repository.updateGroupCode(org,group,code);
        audit.write(org,scope.userId(),"group.code_rotated",group,Map.of());
        return Map.of("code",code);
    }
    @Transactional
    public Map<String,Object> joinGroup(OrgAccess.Scope scope,String code,String ip) {
        if(!scope.roles().contains("STUDENT")) throw WorkspaceError.forbidden();
        repository.requireActiveProfile(scope.userId(),"STUDENT");
        String normalized=code==null?"":code.trim().toUpperCase(Locale.ROOT);
        var found=normalized.matches("[A-Z2-9]{8}")?repository.findGroupByJoinCode(normalized):Optional.<Map<String,Object>>empty();
        boolean valid=found.isPresent() && (scope.platform() || number(found.get(),"organization_id")==scope.organizationId());
        if(!codeLimiter.checkGroupJoin(scope.userId(),ip,valid)) throw codeLimiter.limited();
        if(!valid) throw WorkspaceError.validation("Невалиден код за група или групата е премахната.");
        var group=found.orElseThrow();long org=number(group,"organization_id"),id=number(group,"id");
        // Recheck after locking: a teacher may have replaced the code during lookup.
        var locked=repository.lockGroup(org,id);
        if(!normalized.equals(string(locked,"join_code"))) throw WorkspaceError.validation("Невалиден код за група или групата е премахната.");
        if(scope.platform()) personal.member(org,scope.userId(),"STUDENT");
        else requireActiveMember(org,scope.userId(),"STUDENT");
        boolean alreadyMember=repository.countActiveGroupMembers(org,id,scope.userId())>0;
        if(!alreadyMember) {
            repository.upsertGroupMember(org,id,scope.userId());
            audit.write(org,scope.userId(),"group.student_joined",id,Map.of("student",scope.userId()));
        }
        return Map.of("id",id,"name",string(group,"name"),"alreadyMember",alreadyMember);
    }
    public List<Map<String,Object>> groupMembers(OrgAccess.Scope scope,long group) {
        groupAccess(scope,group);
        return repository.findGroupMembers(scope.organizationId(), group);
    }
    public Object groupTeachers(OrgAccess.Scope scope,long group) {groupAccess(scope,group);return repository.findGroupTeachers(scope.organizationId(), group);}
    @Transactional public void updateGroup(OrgAccess.Scope scope,long group,GroupRequest value) {
        var row=groupAccess(scope,group);long org=number(row,"organization_id");
        repository.lockGroup(org, group);
        if(value==null || value.name()==null || value.name().isBlank() || value.name().length()>190 || value.description()==null || value.description().length()>4000 || value.subject()==null || value.subject().length()>190) throw WorkspaceError.validation("Невалидни данни за групата.");
        repository.updateGroup(value.name(), value.description(), value.subject(), org, group);audit.write(org,scope.userId(),"group.updated",group,Map.of());
    }
    @Transactional public void deleteGroup(OrgAccess.Scope scope,long group) {
        var row=groupAccess(scope,group);long org=number(row,"organization_id");
        repository.lockGroup(org, group);
        // Keep historical assignment sources and results intact while removing the group from use.
        repository.deleteGroup(clock.instant(), org, group);
        audit.write(org,scope.userId(),"group.deleted",group,Map.of("name",string(row,"name")));
    }
    @Transactional public void removeTeacher(OrgAccess.Scope scope,long group,long teacher) {
        groupAccess(scope,group);
        throw WorkspaceError.conflict("Групата има един учител, който не може да бъде премахнат.");
    }
    @Transactional
    public void addStudent(OrgAccess.Scope scope,long group,long student) {
        groupAccess(scope,group); requireActiveMember(scope,student,"STUDENT");
        addStudentInternal(scope.organizationId(),group,student);
        audit.write(scope.organizationId(),scope.userId(),"group.student_added",group,Map.of("student",student));
    }
    private void addStudentInternal(long org,long group,long student) {
        repository.upsertGroupMember(org,group,student);
    }
    @Transactional
    public void removeStudent(OrgAccess.Scope scope,long group,long student) {
        groupAccess(scope,group);
        repository.deactivateGroupMember(scope.organizationId(), group, student);
        var recipients=repository.findFutureRecipients(scope.organizationId(), student, clock.instant());
        for(var r:recipients) {
            List<?> sources=json.parse(r.get("source_groups_json"),List.class);
            if(!flag(r,"individually_assigned") && sources.stream().map(Object::toString).anyMatch(v->v.equals(Long.toString(group))) && sources.stream().map(Object::toString).noneMatch(v->!v.equals(Long.toString(group)) && repository.countActiveGroupMembers(scope.organizationId(), Long.parseLong(v), student)>0)) repository.cancelRecipient(scope.organizationId(), number(r,"assignment_id"), student);
        }
        audit.write(scope.organizationId(),scope.userId(),"group.student_removed",group,Map.of("student",student));
    }
    @Transactional
    public void addTeacher(OrgAccess.Scope scope,long group,long teacher) {
        groupAccess(scope,group);
        throw WorkspaceError.conflict("Всяка група има само един учител. Могат да се добавят само ученици.");
    }
    public List<Map<String,Object>> csvPreview(OrgAccess.Scope scope,long group,String csv) {
        groupAccess(scope,group);
        if(csv.length()>200_000) throw WorkspaceError.validation("CSV файлът е твърде голям.");
        List<Map<String,Object>> result=new ArrayList<>(); Set<String> seen=new HashSet<>();
        try(var parser=CSVFormat.DEFAULT.builder().setHeader().setSkipHeaderRecord(true).get().parse(new StringReader(csv))) {
            if(!parser.getHeaderMap().containsKey("email")) throw WorkspaceError.validation("Нужна е колона email.");
            for(var record:parser) {
                if(result.size()>=1000) throw WorkspaceError.validation("До 1000 реда наведнъж.");
                String email=record.get("email").trim().toLowerCase(Locale.ROOT);
                String status=!email.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")?"invalid":!seen.add(email)?"duplicate":"invitation";
                var member=scope.platform()?repository.findActiveStudentByEmail(email):repository.findMemberStudentByEmail(scope.organizationId(), email);
                Map<String,Object> row=new LinkedHashMap<>(Map.of("row",record.getRecordNumber()+1,"email",email,"status",status));
                if(member.isPresent() && status.equals("invitation")) { row.put("status","member"); row.put("user_id",number(member.get(),"id")); }
                else if(scope.platform() && status.equals("invitation")) row.put("status","unregistered");
                result.add(row);
            }
        } catch(java.io.IOException|IllegalArgumentException error) { throw WorkspaceError.validation("Невалиден CSV файл."); }
        return result;
    }
    public record OrganizationRequest(@NotBlank @Size(max=190) String name,@NotBlank @Size(max=40) String organizationType,@Email @NotBlank @Size(max=190) String contactEmail,@NotBlank @Size(max=80) String timezone,@NotBlank @Size(max=40) String studentLabel) {}
    public record InvitationRequest(@Email @NotBlank @Size(max=190) String email,List<String> roles,Long groupId) {}
    public record MemberChange(List<String> roles,boolean active) {}
    public record GroupRequest(@NotBlank @Size(max=190) String name,@NotNull @Size(max=4000) String description,@NotNull @Size(max=190) String subject) {}
}
