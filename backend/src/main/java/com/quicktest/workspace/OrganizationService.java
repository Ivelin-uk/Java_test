package com.quicktest.workspace;

import jakarta.validation.constraints.*;
import org.apache.commons.csv.CSVFormat;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.StringReader;
import java.time.Clock;
import java.time.Duration;
import java.time.ZoneId;
import java.util.*;
import static com.quicktest.workspace.WorkspaceStore.*;

@Service
public class OrganizationService {
    private final WorkspaceStore db;
    private final WorkspaceCrypto crypto;
    private final WorkspaceAudit audit;
    private final NotificationService notifications;
    private final Clock clock;

    public OrganizationService(WorkspaceStore db, WorkspaceCrypto crypto, WorkspaceAudit audit, NotificationService notifications, Clock clock) {
        this.db = db; this.crypto = crypto; this.audit = audit; this.notifications = notifications; this.clock = clock;
    }
    public List<Map<String, Object>> organizations(long user) {
        return db.rows("SELECT o.*,m.roles_json,s.status subscription_status,s.paid_through FROM organizations o JOIN memberships m ON m.organization_id=o.id JOIN organization_subscriptions s ON s.organization_id=o.id WHERE m.user_id=? AND m.status='active' ORDER BY o.name", user);
    }
    @Transactional
    public Map<String, Object> create(long user, OrganizationRequest request) {
        try { ZoneId.of(request.timezone()); } catch (Exception e) { throw WorkspaceError.validation("Невалидна часова зона."); }
        long id = db.insert("INSERT INTO organizations(name,organization_type,contact_email,timezone,student_label,settings_json,created_at) VALUES(?,?,?,?,?,?,?)", request.name().trim(), request.organizationType(), request.contactEmail(), request.timezone(), request.studentLabel(), db.json(Map.of("passThreshold",50,"gradingScale","bulgarian","studentChat",false)), clock.instant());
        db.insert("INSERT INTO memberships(organization_id,user_id,roles_json,created_at) VALUES(?,?,?,?)", id, user, db.json(List.of("ORG_ADMIN","TEACHER")), clock.instant());
        long plan = number(db.one("SELECT id FROM organization_plans ORDER BY id LIMIT 1"), "id");
        db.update("INSERT INTO organization_subscriptions(organization_id,plan_id,status,paid_through,period_start) VALUES(?,?,'trialing',?,?)", id, plan, clock.instant().plus(Duration.ofDays(14)), clock.instant());
        audit.write(id,user,"organization.created",id,Map.of());
        return db.one("SELECT * FROM organizations WHERE id=?", id);
    }
    public List<Map<String, Object>> members(OrgAccess.Scope scope) {
        if (!scope.roles().contains("TEACHER") && !scope.roles().contains("ORG_ADMIN")) throw WorkspaceError.forbidden();
        return db.rows("SELECT m.id,m.user_id,m.roles_json,m.status,u.name,u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=? ORDER BY u.name", scope.organizationId());
    }
    public void requireActiveMember(long org, long user, String role) {
        var row = db.one("SELECT roles_json FROM memberships WHERE organization_id=? AND user_id=? AND status='active'", org,user);
        if (!Arrays.asList(db.parse(row.get("roles_json"), String[].class)).contains(role)) throw WorkspaceError.forbidden();
    }
    public Map<String,Object> subscription(long org) {
        return db.one("SELECT s.*,p.name plan_name,p.teacher_limit,p.student_limit,p.ai_limit,p.storage_bytes,p.monthly_eur,p.yearly_eur,p.demonstration FROM organization_subscriptions s JOIN organization_plans p ON p.id=s.plan_id WHERE s.organization_id=?", org);
    }
    public void requirePaid(long org) {
        var subscription = subscription(org);
        if (!List.of("active","trialing","canceled").contains(string(subscription,"status")) || !clock.instant().isBefore(time(subscription,"paid_through")))
            throw WorkspaceError.expired("Абонаментът е изтекъл. Историята и проверката остават достъпни.");
    }
    public void lockQuota(long org) {
        // Parent organization locks would conflict with membership and attempt foreign keys.
        db.update("INSERT INTO organization_quota_locks(organization_id) VALUES(?) ON DUPLICATE KEY UPDATE organization_id=organization_id",org);
        db.one("SELECT organization_id FROM organization_quota_locks WHERE organization_id=? FOR UPDATE",org);
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
            long members = db.count("SELECT COUNT(*) FROM memberships WHERE organization_id=? AND status='active' AND roles_json LIKE ? AND user_id<>?",org,"%\""+role+"\"%", excludingUser == null ? -1 : excludingUser);
            long reserved = db.count("SELECT COUNT(*) FROM organization_invitations WHERE organization_id=? AND consumed_at IS NULL AND expires_at>? AND roles_json LIKE ?",org,clock.instant(),"%\""+role+"\"%");
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
        if (db.count("SELECT COUNT(*) FROM organization_invitations WHERE organization_id=? AND email=? AND consumed_at IS NULL AND expires_at>?",scope.organizationId(),email,clock.instant())>0) throw WorkspaceError.conflict("Вече има активна покана за този адрес.");
        if (db.count("SELECT COUNT(*) FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=? AND u.email=? AND m.status='active'", scope.organizationId(),email)>0) throw WorkspaceError.conflict("Потребителят вече е член. Добавете го към групата от списъка.");
        quota(scope.organizationId(),requested,null);
        String token = crypto.token();
        long id = db.insert("INSERT INTO organization_invitations(organization_id,email,roles_json,group_id,token_hash,expires_at,created_by) VALUES(?,?,?,?,?,?,?)",scope.organizationId(),email,db.json(requested),request.groupId(),crypto.hash(token),clock.instant().plus(Duration.ofDays(7)),scope.userId());
        audit.write(scope.organizationId(),scope.userId(),"invitation.created",id,Map.of("roles",requested));
        notifications.enqueue(scope.organizationId(),null,null,"invitation",email,Map.of("token",token,"organization",string(db.one("SELECT name FROM organizations WHERE id=?",scope.organizationId()),"name"),"expires_at",clock.instant().plus(Duration.ofDays(7)).toString()));
        // The administrator may copy an invitation; the secret is never stored in audit.
        return Map.of("id",id,"token",token,"email",email,"expires_at",clock.instant().plus(Duration.ofDays(7)).toString());
    }
    @Transactional
    public Map<String,Object> accept(long user, String token) {
        var invite = db.one("SELECT * FROM organization_invitations WHERE token_hash=? FOR UPDATE",crypto.hash(token));
        long org = number(invite,"organization_id");
        lockQuota(org);
        if (invite.get("consumed_at")!=null || !clock.instant().isBefore(time(invite,"expires_at"))) throw WorkspaceError.expired("Поканата е използвана или е изтекла.");
        var address = db.one("SELECT email,verified_at FROM notification_addresses WHERE user_id=?",user);
        if (address.get("verified_at")==null || !string(address,"email").equalsIgnoreCase(string(invite,"email"))) throw WorkspaceError.forbidden();
        db.update("UPDATE organization_invitations SET consumed_at=? WHERE id=?",clock.instant(),number(invite,"id"));
        List<String> requested=Arrays.asList(db.parse(invite.get("roles_json"),String[].class));
        quota(org,requested,user);
        var existing=db.optional("SELECT id FROM memberships WHERE organization_id=? AND user_id=?",org,user);
        if(existing.isPresent()) db.update("UPDATE memberships SET roles_json=?,status='active' WHERE organization_id=? AND user_id=?",db.json(requested),org,user);
        else db.insert("INSERT INTO memberships(organization_id,user_id,roles_json,created_at) VALUES(?,?,?,?)",org,user,db.json(requested),clock.instant());
        if(invite.get("group_id")!=null) addStudentInternal(org,number(invite,"group_id"),user);
        audit.write(org,user,"invitation.accepted",number(invite,"id"),Map.of());
        return db.one("SELECT * FROM organizations WHERE id=?",org);
    }
    @Transactional
    public void changeMember(OrgAccess.Scope scope,long user,MemberChange request) {
        lockQuota(scope.organizationId());
        var current=db.one("SELECT * FROM memberships WHERE organization_id=? AND user_id=? FOR UPDATE",scope.organizationId(),user);
        List<String> roles=roles(request.roles());
        if(string(current,"roles_json").contains("ORG_ADMIN") && (!request.active() || !roles.contains("ORG_ADMIN")) && db.count("SELECT COUNT(*) FROM memberships WHERE organization_id=? AND status='active' AND roles_json LIKE '%ORG_ADMIN%'",scope.organizationId())<=1) throw WorkspaceError.conflict("Нужен е поне един активен организационен администратор.");
        if(request.active()) {
            List<String> added=roles.stream().filter(role->!string(current,"roles_json").contains(role) || !string(current,"status").equals("active")).toList();
            quota(scope.organizationId(),added,user);
        }
        db.update("UPDATE memberships SET roles_json=?,status=? WHERE organization_id=? AND user_id=?",db.json(roles),request.active()?"active":"inactive",scope.organizationId(),user);
        audit.write(scope.organizationId(),scope.userId(),"membership.changed",user,Map.of("roles",roles,"active",request.active()));
    }
    public Map<String,Object> groupAccess(OrgAccess.Scope scope,long group) {
        var row=db.one("SELECT * FROM learning_groups WHERE organization_id=? AND id=?",scope.organizationId(),group);
        if(!scope.roles().contains("ORG_ADMIN") && db.count("SELECT COUNT(*) FROM group_teachers WHERE organization_id=? AND group_id=? AND user_id=?",scope.organizationId(),group,scope.userId())==0) throw WorkspaceError.forbidden();
        return row;
    }
    public List<Map<String,Object>> groups(OrgAccess.Scope scope) {
        if(scope.roles().contains("ORG_ADMIN")) return db.rows("SELECT * FROM learning_groups WHERE organization_id=? ORDER BY name",scope.organizationId());
        return db.rows("SELECT DISTINCT g.* FROM learning_groups g LEFT JOIN group_teachers t ON t.organization_id=g.organization_id AND t.group_id=g.id LEFT JOIN group_members m ON m.organization_id=g.organization_id AND m.group_id=g.id AND m.active=TRUE WHERE g.organization_id=? AND (t.user_id=? OR m.user_id=?) ORDER BY g.name",scope.organizationId(),scope.userId(),scope.userId());
    }
    @Transactional
    public Map<String,Object> createGroup(OrgAccess.Scope scope,GroupRequest request) {
        long id=db.insert("INSERT INTO learning_groups(organization_id,name,description,subject,school_year,class_label,created_at) VALUES(?,?,?,?,?,?,?)",scope.organizationId(),request.name(),request.description(),request.subject(),request.schoolYear(),request.classLabel(),clock.instant());
        db.update("INSERT INTO group_teachers(organization_id,group_id,user_id) VALUES(?,?,?)",scope.organizationId(),id,scope.userId());
        long conversation=db.insert("INSERT INTO workspace_conversations(organization_id,group_id,title) VALUES(?,?,?)",scope.organizationId(),id,request.name());db.update("INSERT INTO conversation_members(organization_id,conversation_id,user_id) VALUES(?,?,?)",scope.organizationId(),conversation,scope.userId());
        audit.write(scope.organizationId(),scope.userId(),"group.created",id,Map.of());
        return groupAccess(scope,id);
    }
    public List<Map<String,Object>> groupMembers(OrgAccess.Scope scope,long group) {
        groupAccess(scope,group);
        return db.rows("SELECT u.id user_id,u.name,u.email,m.active FROM group_members m JOIN users u ON u.id=m.user_id WHERE m.organization_id=? AND m.group_id=? ORDER BY u.name",scope.organizationId(),group);
    }
    public Object groupTeachers(OrgAccess.Scope scope,long group) {groupAccess(scope,group);return db.rows("SELECT u.id user_id,u.name FROM group_teachers t JOIN users u ON u.id=t.user_id WHERE t.organization_id=? AND t.group_id=? ORDER BY u.name",scope.organizationId(),group);}
    @Transactional public void updateGroup(OrgAccess.Scope scope,long group,GroupChange request) {
        groupAccess(scope,group);var value=request.profile();
        if(value==null || value.name()==null || value.name().isBlank() || value.name().length()>190 || value.description()==null || value.description().length()>4000 || value.subject()==null || value.subject().length()>190 || value.schoolYear()==null || value.schoolYear().length()>40 || value.classLabel()==null || value.classLabel().length()>80 || !Set.of("active","archived").contains(request.status())) throw WorkspaceError.validation("Невалидни данни за групата.");
        db.update("UPDATE learning_groups SET name=?,description=?,subject=?,school_year=?,class_label=?,status=? WHERE organization_id=? AND id=?",value.name(),value.description(),value.subject(),value.schoolYear(),value.classLabel(),request.status(),scope.organizationId(),group);audit.write(scope.organizationId(),scope.userId(),"group.updated",group,Map.of("status",request.status()));
    }
    @Transactional public void removeTeacher(OrgAccess.Scope scope,long group,long teacher) {
        groupAccess(scope,group);db.one("SELECT id FROM learning_groups WHERE organization_id=? AND id=? FOR UPDATE",scope.organizationId(),group);
        if(db.count("SELECT COUNT(*) FROM group_teachers WHERE organization_id=? AND group_id=?",scope.organizationId(),group)<=1) throw WorkspaceError.conflict("Нужен е поне един учител.");
        db.update("DELETE FROM group_teachers WHERE organization_id=? AND group_id=? AND user_id=?",scope.organizationId(),group,teacher);audit.write(scope.organizationId(),scope.userId(),"group.teacher_removed",group,Map.of("teacher",teacher));
    }
    @Transactional
    public void addStudent(OrgAccess.Scope scope,long group,long student) {
        groupAccess(scope,group); requireActiveMember(scope.organizationId(),student,"STUDENT");
        addStudentInternal(scope.organizationId(),group,student);
        audit.write(scope.organizationId(),scope.userId(),"group.student_added",group,Map.of("student",student));
    }
    private void addStudentInternal(long org,long group,long student) {
        if(db.count("SELECT COUNT(*) FROM group_members WHERE organization_id=? AND group_id=? AND user_id=?",org,group,student)==0) db.update("INSERT INTO group_members(organization_id,group_id,user_id) VALUES(?,?,?)",org,group,student);
        else db.update("UPDATE group_members SET active=TRUE WHERE organization_id=? AND group_id=? AND user_id=?",org,group,student);
        joinGroupChats(org,group,student);
    }
    private void joinGroupChats(long org,long group,long user) {for(var conversation:db.rows("SELECT id FROM workspace_conversations WHERE organization_id=? AND group_id=?",org,group)) db.update("INSERT INTO conversation_members(organization_id,conversation_id,user_id) VALUES(?,?,?) ON DUPLICATE KEY UPDATE user_id=user_id",org,number(conversation,"id"),user);}
    @Transactional
    public void removeStudent(OrgAccess.Scope scope,long group,long student) {
        groupAccess(scope,group);
        db.update("UPDATE group_members SET active=FALSE WHERE organization_id=? AND group_id=? AND user_id=?",scope.organizationId(),group,student);
        var recipients=db.rows("SELECT r.* FROM assignment_recipients r JOIN exam_assignments a ON a.organization_id=r.organization_id AND a.id=r.assignment_id WHERE r.organization_id=? AND r.student_id=? AND a.starts_at>?",scope.organizationId(),student,clock.instant());
        for(var r:recipients) {
            List<?> sources=db.parse(r.get("source_groups_json"),List.class);
            if(!flag(r,"individually_assigned") && sources.stream().map(Object::toString).anyMatch(v->v.equals(Long.toString(group))) && sources.stream().map(Object::toString).noneMatch(v->!v.equals(Long.toString(group)) && db.count("SELECT COUNT(*) FROM group_members WHERE organization_id=? AND group_id=? AND user_id=? AND active=TRUE",scope.organizationId(),Long.parseLong(v),student)>0)) db.update("UPDATE assignment_recipients SET canceled=TRUE WHERE organization_id=? AND assignment_id=? AND student_id=?",scope.organizationId(),number(r,"assignment_id"),student);
        }
        audit.write(scope.organizationId(),scope.userId(),"group.student_removed",group,Map.of("student",student));
    }
    @Transactional
    public void addTeacher(OrgAccess.Scope scope,long group,long teacher) {
        groupAccess(scope,group); requireActiveMember(scope.organizationId(),teacher,"TEACHER");
        if(db.count("SELECT COUNT(*) FROM group_teachers WHERE organization_id=? AND group_id=? AND user_id=?",scope.organizationId(),group,teacher)==0) db.update("INSERT INTO group_teachers(organization_id,group_id,user_id) VALUES(?,?,?)",scope.organizationId(),group,teacher);
        joinGroupChats(scope.organizationId(),group,teacher);
        audit.write(scope.organizationId(),scope.userId(),"group.teacher_added",group,Map.of("teacher",teacher));
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
                var member=db.optional("SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.organization_id=? AND m.status='active' AND m.roles_json LIKE '%STUDENT%' AND u.email=?",scope.organizationId(),email);
                Map<String,Object> row=new LinkedHashMap<>(Map.of("row",record.getRecordNumber()+1,"email",email,"status",status));
                if(member.isPresent() && status.equals("invitation")) { row.put("status","member"); row.put("user_id",number(member.get(),"id")); }
                result.add(row);
            }
        } catch(java.io.IOException|IllegalArgumentException error) { throw WorkspaceError.validation("Невалиден CSV файл."); }
        return result;
    }
    public record OrganizationRequest(@NotBlank @Size(max=190) String name,@NotBlank @Size(max=40) String organizationType,@Email @NotBlank @Size(max=190) String contactEmail,@NotBlank @Size(max=80) String timezone,@NotBlank @Size(max=40) String studentLabel) {}
    public record InvitationRequest(@Email @NotBlank @Size(max=190) String email,List<String> roles,Long groupId) {}
    public record MemberChange(List<String> roles,boolean active) {}
    public record GroupRequest(@NotBlank @Size(max=190) String name,@NotNull @Size(max=4000) String description,@NotNull @Size(max=190) String subject,@NotNull @Size(max=40) String schoolYear,@NotNull @Size(max=80) String classLabel) {}
    public record GroupChange(GroupRequest profile,String status) {}
}
