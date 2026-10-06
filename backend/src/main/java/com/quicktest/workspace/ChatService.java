package com.quicktest.workspace;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Clock;
import java.util.*;
import static com.quicktest.workspace.WorkspaceStore.*;

@Service
public class ChatService {
    private final WorkspaceStore db;private final OrganizationService organizations;private final Clock clock;private final ProfileExamMutex mutex;private final WorkspaceAudit audit;
    public ChatService(WorkspaceStore db,OrganizationService organizations,Clock clock,ProfileExamMutex mutex,WorkspaceAudit audit) {this.db=db;this.organizations=organizations;this.clock=clock;this.mutex=mutex;this.audit=audit;}
    public void examGuard(OrgAccess.Scope scope) {
        mutex.lock(scope.userId());
        if(db.count("SELECT COUNT(*) FROM exam_attempts WHERE student_id=? AND status='in_progress'",scope.userId())>0) throw WorkspaceError.conflict("Чатът е спрян за всички сесии по време на активен изпит.");
    }
    public Map<String,Object> conversation(OrgAccess.Scope scope,long id) {
        var row=db.one("SELECT c.* FROM workspace_conversations c JOIN conversation_members m ON m.organization_id=c.organization_id AND m.conversation_id=c.id WHERE c.organization_id=? AND c.id=? AND m.user_id=?",scope.organizationId(),id,scope.userId());
        if(row.get("group_id")!=null) {
            long group=number(row,"group_id");
            boolean member=scope.roles().contains("ORG_ADMIN") || scope.roles().contains("STUDENT") && db.count("SELECT COUNT(*) FROM group_members WHERE organization_id=? AND group_id=? AND user_id=? AND active=TRUE",scope.organizationId(),group,scope.userId())>0 || scope.roles().contains("TEACHER") && db.count("SELECT COUNT(*) FROM group_teachers WHERE organization_id=? AND group_id=? AND user_id=?",scope.organizationId(),group,scope.userId())>0;
            if(!member) throw WorkspaceError.forbidden();
        }
        return row;
    }
    private boolean blocked(OrgAccess.Scope scope,long user) {return db.count("SELECT COUNT(*) FROM message_blocks WHERE organization_id=? AND ((user_id=? AND blocked_user_id=?) OR (user_id=? AND blocked_user_id=?))",scope.organizationId(),scope.userId(),user,user,scope.userId())>0;}
    @Transactional
    public List<Map<String,Object>> list(OrgAccess.Scope scope) {
        examGuard(scope);
        return db.rows("SELECT c.id,c.title,c.group_id,m.read_through,(SELECT COUNT(*) FROM workspace_messages x WHERE x.organization_id=c.organization_id AND x.conversation_id=c.id AND x.id>m.read_through AND x.sender_id<>?) unread FROM workspace_conversations c JOIN conversation_members m ON m.organization_id=c.organization_id AND m.conversation_id=c.id WHERE c.organization_id=? AND m.user_id=? ORDER BY c.id DESC",scope.userId(),scope.organizationId(),scope.userId()).stream().filter(c->{try {conversation(scope,number(c,"id"));return true;}catch(WorkspaceError e){return false;}}).toList();
    }
    @Transactional
    public Map<String,Object> create(OrgAccess.Scope scope,Conversation request) {
        examGuard(scope);Set<Long> recipients=new LinkedHashSet<>();recipients.add(scope.userId());
        String title;
        if(request.groupId()!=null) {
            var group=organizations.groupAccess(scope,request.groupId());db.one("SELECT id FROM learning_groups WHERE organization_id=? AND id=? FOR UPDATE",scope.organizationId(),request.groupId());title=string(group,"name");
            var existing=db.optional("SELECT id FROM workspace_conversations WHERE organization_id=? AND group_id=? ORDER BY id LIMIT 1",scope.organizationId(),request.groupId());
            if(existing.isPresent()) return conversation(scope,number(existing.get(),"id"));
            for(var row:db.rows("SELECT user_id FROM group_members WHERE organization_id=? AND group_id=? AND active=TRUE UNION SELECT user_id FROM group_teachers WHERE organization_id=? AND group_id=?",scope.organizationId(),request.groupId(),scope.organizationId(),request.groupId())) recipients.add(number(row,"user_id"));
        } else {
            if(request.userId()==null || request.userId()==scope.userId()) throw WorkspaceError.validation("Изберете събеседник.");
            if(blocked(scope,request.userId())) throw WorkspaceError.forbidden();
            var member=db.one("SELECT m.roles_json,u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=? AND m.user_id=? AND m.status='active'",scope.organizationId(),request.userId());
            var settings=db.object(db.one("SELECT settings_json FROM organizations WHERE id=?",scope.organizationId()).get("settings_json"));
            if(scope.roles().equals(Set.of("STUDENT")) && string(member,"roles_json").contains("STUDENT") && !Boolean.TRUE.equals(settings.get("studentChat"))) throw WorkspaceError.forbidden();
            recipients.add(request.userId());title=string(member,"name");
        }
        long id=db.insert("INSERT INTO workspace_conversations(organization_id,group_id,title) VALUES(?,?,?)",scope.organizationId(),request.groupId(),title);
        for(long user:recipients) db.update("INSERT INTO conversation_members(organization_id,conversation_id,user_id) VALUES(?,?,?)",scope.organizationId(),id,user);
        return conversation(scope,id);
    }
    @Transactional
    public List<Map<String,Object>> messages(OrgAccess.Scope scope,long id,long after) {
        examGuard(scope);conversation(scope,id);
        var messages=db.rows("SELECT m.id,m.sender_id,u.name sender_name,m.body,m.created_at FROM workspace_messages m JOIN users u ON u.id=m.sender_id WHERE m.organization_id=? AND m.conversation_id=? AND m.id>? AND m.hidden=FALSE AND NOT EXISTS (SELECT 1 FROM message_blocks b WHERE b.organization_id=m.organization_id AND ((b.user_id=? AND b.blocked_user_id=m.sender_id) OR (b.blocked_user_id=? AND b.user_id=m.sender_id))) ORDER BY m.id LIMIT 100",scope.organizationId(),id,Math.max(after,0),scope.userId(),scope.userId());
        if(!messages.isEmpty()) db.update("UPDATE conversation_members SET read_through=? WHERE organization_id=? AND conversation_id=? AND user_id=?",number(messages.getLast(),"id"),scope.organizationId(),id,scope.userId());
        return messages;
    }
    @Transactional
    public void send(OrgAccess.Scope scope,long id,String body) {
        examGuard(scope);var c=conversation(scope,id);
        if(c.get("group_id")==null) for(var member:db.rows("SELECT user_id FROM conversation_members WHERE organization_id=? AND conversation_id=?",scope.organizationId(),id)) if(blocked(scope,number(member,"user_id"))) throw WorkspaceError.forbidden();
        if(c.get("group_id")!=null && !string(db.one("SELECT status FROM learning_groups WHERE organization_id=? AND id=?",scope.organizationId(),number(c,"group_id")),"status").equals("active")) throw WorkspaceError.conflict("Групата е архивирана.");
        if(body==null || body.isBlank() || body.length()>4000) throw WorkspaceError.validation("Съобщение: 1–4000 символа.");
        db.insert("INSERT INTO workspace_messages(organization_id,conversation_id,sender_id,body,created_at) VALUES(?,?,?,?,?)",scope.organizationId(),id,scope.userId(),body.strip(),clock.instant());
    }
    @Transactional public void block(OrgAccess.Scope scope,long user,boolean blocked) {
        examGuard(scope);db.one("SELECT user_id FROM memberships WHERE organization_id=? AND user_id=? AND status='active'",scope.organizationId(),user);
        if(user==scope.userId()) throw WorkspaceError.validation("Изберете друг потребител.");
        if(blocked) db.update("INSERT INTO message_blocks(organization_id,user_id,blocked_user_id) VALUES(?,?,?) ON DUPLICATE KEY UPDATE user_id=user_id",scope.organizationId(),scope.userId(),user);
        else db.update("DELETE FROM message_blocks WHERE organization_id=? AND user_id=? AND blocked_user_id=?",scope.organizationId(),scope.userId(),user);
        audit.write(scope.organizationId(),scope.userId(),"chat.block_changed",user,Map.of("blocked",blocked));
    }
    @Transactional public void report(OrgAccess.Scope scope,long message,String reason) {
        examGuard(scope);if(reason==null || reason.isBlank() || reason.length()>1000) throw WorkspaceError.validation("Причина: 1–1000 символа.");
        var row=db.one("SELECT conversation_id FROM workspace_messages WHERE organization_id=? AND id=?",scope.organizationId(),message);conversation(scope,number(row,"conversation_id"));
        long id=db.insert("INSERT INTO message_reports(organization_id,message_id,reporter_id,reason,created_at) VALUES(?,?,?,?,?)",scope.organizationId(),message,scope.userId(),reason.strip(),clock.instant());audit.write(scope.organizationId(),scope.userId(),"chat.reported",id,Map.of());
    }
    @Transactional public void moderate(OrgAccess.Scope scope,long report,String resolution,boolean hide) {
        if(resolution==null || resolution.isBlank() || resolution.length()>1000) throw WorkspaceError.validation("Решение: 1–1000 символа.");
        var row=db.one("SELECT * FROM message_reports WHERE organization_id=? AND id=? FOR UPDATE",scope.organizationId(),report);
        db.update("UPDATE message_reports SET status='resolved',resolution=?,resolved_by=?,resolved_at=? WHERE organization_id=? AND id=?",resolution,scope.userId(),clock.instant(),scope.organizationId(),report);
        if(hide) db.update("UPDATE workspace_messages SET hidden=TRUE WHERE organization_id=? AND id=?",scope.organizationId(),number(row,"message_id"));
        audit.write(scope.organizationId(),scope.userId(),"chat.moderated",report,Map.of("hidden",hide,"reason",resolution));
    }
    public record Conversation(Long userId,Long groupId) {}
}
