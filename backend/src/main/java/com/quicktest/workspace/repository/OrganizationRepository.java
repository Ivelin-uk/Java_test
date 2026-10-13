package com.quicktest.workspace.repository;

import com.quicktest.workspace.WorkspaceStore;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.*;

@Repository
public class OrganizationRepository {
    private final WorkspaceStore store;

    public OrganizationRepository(WorkspaceStore store) {
        this.store = store;
    }

    public List<Map<String, Object>> findOrganizations(long user) {
        return store.rows("SELECT o.*,m.roles_json,s.status subscription_status,s.paid_through FROM organizations o JOIN memberships m ON m.organization_id=o.id JOIN organization_subscriptions s ON s.organization_id=o.id WHERE m.user_id=? AND m.status='active' ORDER BY o.name", user);
    }

    public long insertOrganization(String trim, String organizationType, String contactEmail, String timezone, String studentLabel, String jsonValue, Instant timestamp) {
        return store.insert("INSERT INTO organizations(name,organization_type,contact_email,timezone,student_label,settings_json,created_at) VALUES(?,?,?,?,?,?,?)", trim, organizationType, contactEmail, timezone, studentLabel, jsonValue, timestamp);
    }

    public long insertMembership(long id, long user, String jsonValue, Instant timestamp) {
        return store.insert("INSERT INTO memberships(organization_id,user_id,roles_json,created_at) VALUES(?,?,?,?)", id, user, jsonValue, timestamp);
    }

    public Map<String, Object> requireFirstPlan() {
        return store.one("SELECT id FROM organization_plans ORDER BY id LIMIT 1");
    }

    public int insertTrialSubscription(long id, long plan, Instant value, Instant timestamp) {
        return store.update("INSERT INTO organization_subscriptions(organization_id,plan_id,status,paid_through,period_start) VALUES(?,?,'trialing',?,?)", id, plan, value, timestamp);
    }

    public Map<String, Object> requireOrganization(long id) {
        return store.one("SELECT * FROM organizations WHERE id=?", id);
    }

    public List<Map<String, Object>> findActiveProfiles() {
        return store.rows("SELECT id user_id,name,email,role FROM users WHERE active=TRUE AND role IN ('TEACHER','STUDENT') ORDER BY name");
    }

    public List<Map<String, Object>> findMembers(long organizationId) {
        return store.rows("SELECT m.id,m.user_id,m.roles_json,m.status,u.name,u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=? ORDER BY u.name", organizationId);
    }

    public Map<String, Object> requireActiveMembership(long org, long user) {
        return store.one("SELECT roles_json FROM memberships WHERE organization_id=? AND user_id=? AND status='active'", org, user);
    }

    public Map<String, Object> requireActiveProfile(long user, String role) {
        return store.one("SELECT id FROM users WHERE id=? AND active=TRUE AND role=?", user, role);
    }

    public Map<String, Object> requireSubscription(long org) {
        return store.one("SELECT s.*,p.name plan_name,p.teacher_limit,p.student_limit,p.ai_limit,p.storage_bytes,p.monthly_eur,p.yearly_eur,p.demonstration FROM organization_subscriptions s JOIN organization_plans p ON p.id=s.plan_id WHERE s.organization_id=?", org);
    }

    public int ensureQuotaLock(long org) {
        return store.update("INSERT INTO organization_quota_locks(organization_id) VALUES(?) ON DUPLICATE KEY UPDATE organization_id=organization_id", org);
    }

    public Map<String, Object> lockQuota(long org) {
        return store.one("SELECT organization_id FROM organization_quota_locks WHERE organization_id=? FOR UPDATE", org);
    }

    public long countActiveRoleMembers(long org, String value, long value2) {
        return store.count("SELECT COUNT(*) FROM memberships WHERE organization_id=? AND status='active' AND roles_json LIKE ? AND user_id<>?", org, value, value2);
    }

    public long countPendingRoleInvitations(long org, Instant timestamp, String value) {
        return store.count("SELECT COUNT(*) FROM organization_invitations WHERE organization_id=? AND consumed_at IS NULL AND expires_at>? AND roles_json LIKE ?", org, timestamp, value);
    }

    public long countEmailInvitations(long organizationId, String email, Instant timestamp) {
        return store.count("SELECT COUNT(*) FROM organization_invitations WHERE organization_id=? AND email=? AND consumed_at IS NULL AND expires_at>?", organizationId, email, timestamp);
    }

    public long countEmailMembers(long organizationId, String email) {
        return store.count("SELECT COUNT(*) FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=? AND u.email=? AND m.status='active'", organizationId, email);
    }

    public long insertInvitation(long organizationId, String email, String jsonValue, Long groupId, String value, Instant value2, long userId) {
        return store.insert("INSERT INTO organization_invitations(organization_id,email,roles_json,group_id,token_hash,expires_at,created_by) VALUES(?,?,?,?,?,?,?)", organizationId, email, jsonValue, groupId, value, value2, userId);
    }

    public Map<String, Object> requireOrganizationName(long organizationId) {
        return store.one("SELECT name FROM organizations WHERE id=?", organizationId);
    }

    public Map<String, Object> lockInvitation(String value) {
        return store.one("SELECT * FROM organization_invitations WHERE token_hash=? FOR UPDATE", value);
    }

    public Map<String, Object> requireNotificationAddress(long user) {
        return store.one("SELECT email,verified_at FROM notification_addresses WHERE user_id=?", user);
    }

    public int consumeInvitation(Instant timestamp, long id) {
        return store.update("UPDATE organization_invitations SET consumed_at=? WHERE id=?", timestamp, id);
    }

    public Optional<Map<String, Object>> findMembership(long org, long user) {
        return store.optional("SELECT id FROM memberships WHERE organization_id=? AND user_id=?", org, user);
    }

    public int activateMembership(String jsonValue, long org, long user) {
        return store.update("UPDATE memberships SET roles_json=?,status='active' WHERE organization_id=? AND user_id=?", jsonValue, org, user);
    }

    public Map<String, Object> lockMembership(long organizationId, long user) {
        return store.one("SELECT * FROM memberships WHERE organization_id=? AND user_id=? FOR UPDATE", organizationId, user);
    }

    public long countAdministrators(long organizationId) {
        return store.count("SELECT COUNT(*) FROM memberships WHERE organization_id=? AND status='active' AND roles_json LIKE '%ORG_ADMIN%'", organizationId);
    }

    public int updateMembership(String jsonValue, Object value, long organizationId, long user) {
        return store.update("UPDATE memberships SET roles_json=?,status=? WHERE organization_id=? AND user_id=?", jsonValue, value, organizationId, user);
    }

    public Map<String, Object> requireGroup(long organizationId, boolean platform, long group) {
        return store.one("SELECT * FROM learning_groups WHERE (organization_id=? OR ?) AND id=? AND deleted_at IS NULL", organizationId, platform, group);
    }

    public long countGroupTeachers(long organizationId, long group, long userId) {
        return store.count("SELECT COUNT(*) FROM group_teachers WHERE organization_id=? AND group_id=? AND user_id=?", organizationId, group, userId);
    }

    public List<Map<String, Object>> findOrganizationGroups(long organizationId) {
        return store.rows("SELECT * FROM learning_groups WHERE organization_id=? AND deleted_at IS NULL ORDER BY name", organizationId);
    }

    public List<Map<String, Object>> findVisibleGroups(long organizationId, boolean platform, long userId, long userId2) {
        return store.rows("SELECT DISTINCT g.* FROM learning_groups g LEFT JOIN group_teachers t ON t.organization_id=g.organization_id AND t.group_id=g.id LEFT JOIN group_members m ON m.organization_id=g.organization_id AND m.group_id=g.id AND m.active=TRUE WHERE (g.organization_id=? OR ?) AND g.deleted_at IS NULL AND (t.user_id=? OR m.user_id=?) ORDER BY g.name", organizationId, platform, userId, userId2);
    }

    public long insertGroup(long organizationId, String name, String description, String subject, Instant timestamp) {
        return store.insert("INSERT INTO learning_groups(organization_id,name,description,subject,created_at) VALUES(?,?,?,?,?)", organizationId, name, description, subject, timestamp);
    }

    public int insertGroupTeacher(long organizationId, long id, long userId) {
        return store.update("INSERT INTO group_teachers(organization_id,group_id,user_id) VALUES(?,?,?)", organizationId, id, userId);
    }

    public List<Map<String, Object>> findGroupMembers(long organizationId, long group) {
        return store.rows("SELECT u.id user_id,u.name,u.email,m.active FROM group_members m JOIN users u ON u.id=m.user_id WHERE m.organization_id=? AND m.group_id=? ORDER BY u.name", organizationId, group);
    }

    public List<Map<String, Object>> findGroupTeachers(long organizationId, long group) {
        return store.rows("SELECT u.id user_id,u.name FROM group_teachers t JOIN users u ON u.id=t.user_id WHERE t.organization_id=? AND t.group_id=? ORDER BY u.name", organizationId, group);
    }

    public Map<String, Object> lockGroup(long org, long group) {
        return store.one("SELECT id FROM learning_groups WHERE organization_id=? AND id=? AND deleted_at IS NULL FOR UPDATE", org, group);
    }

    public int updateGroup(String name, String description, String subject, long org, long group) {
        return store.update("UPDATE learning_groups SET name=?,description=?,subject=? WHERE organization_id=? AND id=?", name, description, subject, org, group);
    }

    public int deleteGroup(Instant timestamp, long org, long group) {
        return store.update("UPDATE learning_groups SET deleted_at=? WHERE organization_id=? AND id=?", timestamp, org, group);
    }

    public long countGroupMemberships(long org, long group, long student) {
        return store.count("SELECT COUNT(*) FROM group_members WHERE organization_id=? AND group_id=? AND user_id=?", org, group, student);
    }

    public int insertGroupMember(long org, long group, long student) {
        return store.update("INSERT INTO group_members(organization_id,group_id,user_id) VALUES(?,?,?)", org, group, student);
    }

    public int activateGroupMember(long org, long group, long student) {
        return store.update("UPDATE group_members SET active=TRUE WHERE organization_id=? AND group_id=? AND user_id=?", org, group, student);
    }

    public int deactivateGroupMember(long organizationId, long group, long student) {
        return store.update("UPDATE group_members SET active=FALSE WHERE organization_id=? AND group_id=? AND user_id=?", organizationId, group, student);
    }

    public List<Map<String, Object>> findFutureRecipients(long organizationId, long student, Instant timestamp) {
        return store.rows("SELECT r.* FROM assignment_recipients r JOIN exam_assignments a ON a.organization_id=r.organization_id AND a.id=r.assignment_id WHERE r.organization_id=? AND r.student_id=? AND a.starts_at>?", organizationId, student, timestamp);
    }

    public long countActiveGroupMembers(long organizationId, long value, long student) {
        return store.count("SELECT COUNT(*) FROM group_members WHERE organization_id=? AND group_id=? AND user_id=? AND active=TRUE", organizationId, value, student);
    }

    public int cancelRecipient(long organizationId, long assignmentId, long student) {
        return store.update("UPDATE assignment_recipients SET canceled=TRUE WHERE organization_id=? AND assignment_id=? AND student_id=?", organizationId, assignmentId, student);
    }

    public Optional<Map<String, Object>> findActiveStudentByEmail(String email) {
        return store.optional("SELECT id FROM users WHERE active=TRUE AND role='STUDENT' AND email=?", email);
    }

    public Optional<Map<String, Object>> findMemberStudentByEmail(long organizationId, String email) {
        return store.optional("SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.organization_id=? AND m.status='active' AND m.roles_json LIKE '%STUDENT%' AND u.email=?", organizationId, email);
    }
}
