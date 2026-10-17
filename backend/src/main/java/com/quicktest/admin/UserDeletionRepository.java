package com.quicktest.admin;

import com.quicktest.workspace.WorkspaceJson;
import com.quicktest.workspace.WorkspaceStore;
import org.springframework.stereotype.Repository;

import java.util.*;
import java.util.stream.Collectors;

import static com.quicktest.workspace.WorkspaceValues.number;

/** Persistence for permanent account deletion. The caller owns authorization and the transaction. */
@Repository
public class UserDeletionRepository {
    private final WorkspaceStore store;
    private final WorkspaceJson json;

    public UserDeletionRepository(WorkspaceStore store, WorkspaceJson json) {
        this.store = store;
        this.json = json;
    }

    public record Plan(long userId, List<Long> personalOrganizationIds, List<Long> organizationIds,
                       Map<String, Long> counts, List<String> blockers) {}

    public Plan preview(long userId) {
        return plan(collect(userId));
    }

    /**
     * Call after the existing administrator/target-user locks in a READ_COMMITTED transaction.
     * Quota precedes attempts and AI jobs, matching AI settlement; retention precedes attempts and
     * outbox, matching retention execution. Fresh reads after locks must see worker claims.
     */
    public Plan lockDependencies(long userId) {
        Scope scope = collect(userId);
        for (long org : scope.organizations()) {
            store.update("INSERT INTO organization_quota_locks(organization_id) VALUES(?) ON DUPLICATE KEY UPDATE organization_id=organization_id", org);
            store.one("SELECT organization_id FROM organization_quota_locks WHERE organization_id=? FOR UPDATE", org);
        }
        for (long org : scope.personalOrganizations()) {
            store.update("INSERT INTO organization_retention_locks(organization_id) VALUES(?) ON DUPLICATE KEY UPDATE organization_id=organization_id", org);
            store.one("SELECT organization_id FROM organization_retention_locks WHERE organization_id=? FOR UPDATE", org);
        }
        // Attempt start holds the profile mutex before its recipient; preserve that order before
        // removing this mutex later. A missing mutex cannot be inserted while the user is locked.
        store.rows("SELECT user_id FROM profile_exam_locks WHERE user_id=? FOR UPDATE", userId);
        // Holding namespace/membership parents prevents new owned resources and account bindings.
        lock("organizations", "id", scope.personalOrganizations());
        store.rows("SELECT id FROM memberships WHERE user_id=? OR " + in("organization_id", scope.personalOrganizations()) + " ORDER BY organization_id,id FOR UPDATE", userId);
        scope = collect(userId);
        lock("workspace_assessments", "id", scope.assessments());
        lock("assessment_versions", "id", scope.versions());
        lock("exam_assignments", "id", scope.assignments());
        lock("learning_groups", "id", scope.groups());
        lock("workspace_conversations", "id", scope.conversations());
        lock("private_images", "id", scope.images());
        lock("tests", "id", scope.legacyTests());
        // A publisher may have committed children while their parent lock was being acquired.
        scope = collect(userId);
        lock("assessment_versions", "id", scope.versions());
        lock("workspace_conversations", "id", scope.conversations());
        store.rows("SELECT organization_id,assignment_id,student_id FROM assignment_recipients WHERE student_id=? OR " + in("assignment_id", scope.assignments()) + " ORDER BY organization_id,assignment_id,student_id FOR UPDATE", userId);
        store.rows("SELECT organization_id,conversation_id,user_id FROM conversation_members WHERE user_id=? OR " + in("conversation_id", scope.conversations()) + " ORDER BY organization_id,conversation_id,user_id FOR UPDATE", userId);
        scope = collect(userId);
        lock("exam_attempts", "id", scope.attempts());
        lock("attempt", "id", scope.legacyAttempts());
        // Result publication locks its attempt first, so the outbox/revision set is now stable.
        scope = collect(userId);
        lock("workspace_ai_jobs", "id", scope.generationJobs());
        lock("workspace_ai_grading_jobs", "id", scope.gradingJobs());
        lock("notification_outbox", "id", scope.notifications());
        // A worker may have claimed a job before the lock was acquired. Read its current state now.
        return plan(collect(userId));
    }

    /** Delete dependencies only. AppUserRepository removes the user after this method returns. */
    public void purge(Plan plan) {
        if (!plan.blockers().isEmpty()) throw new IllegalStateException("Account deletion has unresolved dependencies");
        Scope scope = collect(plan.userId());
        long userId = scope.userId();
        releaseReservations(scope);

        // Historical journals remain readable after both their actor and personal namespace disappear.
        store.update("UPDATE admin_audit SET target_user_id=NULL WHERE target_user_id=?", userId);
        store.update("UPDATE admin_audit SET actor_id=NULL WHERE actor_id=?", userId);
        store.update("UPDATE workspace_audit SET actor_id=NULL WHERE actor_id=?", userId);
        store.update("UPDATE workspace_audit SET organization_id=NULL WHERE " + in("organization_id", scope.personalOrganizations()));
        store.update("UPDATE retention_runs SET actor_id=NULL WHERE actor_id=?", userId);
        store.update("UPDATE retention_runs SET organization_id=NULL WHERE " + in("organization_id", scope.personalOrganizations()));
        // A removed reviewer must not erase another student's published grade.
        store.update("UPDATE result_revisions SET author_id=NULL WHERE author_id=?", userId);

        delete("notification_outbox", "id", scope.notifications());
        delete("workspace_ai_grading_jobs", "id", scope.gradingJobs());
        delete("workspace_ai_jobs", "id", scope.generationJobs());
        delete("exam_events", "attempt_id", scope.attempts());
        delete("result_revisions", "attempt_id", scope.attempts());
        delete("attempt_questions", "attempt_id", scope.attempts());
        delete("exam_attempts", "id", scope.attempts());

        store.update("DELETE FROM assignment_code_deliveries WHERE student_id=? OR " + in("assignment_id", scope.assignments()), userId);
        store.update("DELETE FROM assignment_recipients WHERE student_id=? OR " + in("assignment_id", scope.assignments()), userId);
        store.update("DELETE FROM assignment_teachers WHERE teacher_id=? OR " + in("assignment_id", scope.assignments()), userId);
        delete("exam_assignments", "id", scope.assignments());
        store.update("DELETE FROM assessment_library_removals WHERE user_id=? OR " + in("assessment_id", scope.assessments()), userId);
        delete("assessment_versions", "id", scope.versions());
        delete("workspace_assessments", "id", scope.assessments());
        delete("question_bank_items", "id", scope.bankItems());

        // Reports and realtime grants are children of messages/conversation membership.
        List<Long> messages = ids("SELECT id FROM workspace_messages WHERE sender_id=? OR " + in("conversation_id", scope.conversations()), userId);
        store.update("UPDATE message_reports SET resolved_by=NULL WHERE resolved_by=?", userId);
        store.update("DELETE FROM message_reports WHERE reporter_id=? OR " + in("message_id", messages), userId);
        delete("workspace_messages", "id", messages);
        store.update("DELETE FROM realtime_tickets WHERE user_id=? OR " + in("conversation_id", scope.conversations()), userId);
        store.update("DELETE FROM conversation_members WHERE user_id=? OR " + in("conversation_id", scope.conversations()), userId);
        delete("workspace_conversations", "id", scope.conversations());
        store.update("DELETE FROM message_blocks WHERE user_id=? OR blocked_user_id=? OR " + in("organization_id", scope.personalOrganizations()), userId, userId);

        store.update("DELETE FROM organization_invitations WHERE created_by=? OR " + in("organization_id", scope.personalOrganizations()) + " OR " + in("group_id", scope.groups()), userId);
        store.update("DELETE FROM group_members WHERE user_id=? OR " + in("group_id", scope.groups()), userId);
        store.update("DELETE FROM group_teachers WHERE user_id=? OR " + in("group_id", scope.groups()), userId);
        delete("learning_groups", "id", scope.groups());
        store.update("DELETE FROM support_grants WHERE administrator_id=? OR approved_by=? OR " + in("organization_id", scope.personalOrganizations()), userId, userId);

        // Clear the organization -> logo edge before removing image -> membership edges.
        store.update("UPDATE organizations SET logo_id=NULL WHERE " + in("id", scope.personalOrganizations()));
        delete("private_images", "id", scope.images());
        store.update("DELETE FROM memberships WHERE user_id=? OR " + in("organization_id", scope.personalOrganizations()), userId);

        delete("attempt_answer", "attempt_id", scope.legacyAttempts());
        // Legacy tables do not enforce that an answer's question belongs to its attempt's test.
        delete("attempt_answer", "question_id", scope.legacyQuestions());
        delete("attempt", "id", scope.legacyAttempts());
        delete("answer", "question_id", scope.legacyQuestions());
        delete("question", "id", scope.legacyQuestions());
        delete("tests", "id", scope.legacyTests());

        store.update("DELETE FROM auth_token WHERE user_id=?", userId);
        store.update("DELETE FROM identity_challenges WHERE user_id=?", userId);
        store.update("DELETE FROM external_identities WHERE user_id=?", userId);
        store.update("DELETE FROM notification_addresses WHERE user_id=?", userId);
        store.update("DELETE FROM ai_usage WHERE user_id=?", userId);
        store.update("DELETE FROM profile_exam_locks WHERE user_id=?", userId);
        store.update("DELETE FROM personal_workspaces WHERE user_id=?", userId);

        // External billing is a preview blocker; these are consequently absent for removed namespaces.
        delete("stripe_checkout_requests", "organization_id", scope.personalOrganizations());
        delete("stripe_subscription_bindings", "organization_id", scope.personalOrganizations());
        delete("workspace_billing_events", "organization_id", scope.personalOrganizations());
        delete("tenant_endpoint_permissions", "organization_id", scope.personalOrganizations());
        delete("organization_subscriptions", "organization_id", scope.personalOrganizations());
        delete("organization_retention_locks", "organization_id", scope.personalOrganizations());
        delete("organization_quota_locks", "organization_id", scope.personalOrganizations());
        delete("organizations", "id", scope.personalOrganizations());
    }

    private Plan plan(Scope scope) {
        var counts = new LinkedHashMap<String, Long>();
        counts.put("personalWorkspaces", (long) scope.personalOrganizations().size());
        counts.put("assessments", (long) scope.assessments().size());
        counts.put("assignments", (long) scope.assignments().size());
        counts.put("attempts", (long) scope.attempts().size());
        counts.put("groups", (long) scope.groups().size());
        counts.put("questions", store.count("SELECT COUNT(*) FROM attempt_questions WHERE " + in("attempt_id", scope.attempts())) + scope.legacyQuestions().size());
        counts.put("questionBankItems", (long) scope.bankItems().size());
        counts.put("images", (long) scope.images().size());
        counts.put("aiJobs", (long) scope.generationJobs().size() + scope.gradingJobs().size());
        counts.put("notifications", (long) scope.notifications().size());
        counts.put("memberships", store.count("SELECT COUNT(*) FROM memberships WHERE user_id=? OR " + in("organization_id", scope.personalOrganizations()), scope.userId()));
        counts.put("legacyTests", (long) scope.legacyTests().size());
        counts.put("legacyAttempts", (long) scope.legacyAttempts().size());
        return new Plan(scope.userId(), scope.personalOrganizations(), scope.organizations(),
                Collections.unmodifiableMap(counts), List.copyOf(blockers(scope)));
    }

    private List<String> blockers(Scope scope) {
        var blockers = new ArrayList<String>();
        if (store.count("SELECT COUNT(*) FROM exam_assignments WHERE " + in("version_id", scope.versions()) + " AND NOT (" + in("id", scope.assignments()) + ")") > 0) {
            blockers.add("Други преподаватели използват версии на тестове на този потребител. Прехвърлете тези тестове преди изтриване.");
        }
        if (store.count("SELECT COUNT(*) FROM memberships m WHERE m.user_id=? AND m.status='active' AND m.roles_json LIKE '%ORG_ADMIN%' AND NOT (" + in("m.organization_id", scope.personalOrganizations()) + ") AND NOT EXISTS (SELECT 1 FROM memberships other_member JOIN users other_user ON other_user.id=other_member.user_id WHERE other_member.organization_id=m.organization_id AND other_member.user_id<>m.user_id AND other_member.status='active' AND other_member.roles_json LIKE '%ORG_ADMIN%' AND other_user.active=TRUE)", scope.userId()) > 0) {
            blockers.add("Потребителят е последният активен администратор на споделена организация. Назначете друг администратор преди изтриване.");
        }
        long running = store.count("SELECT COUNT(*) FROM workspace_ai_jobs WHERE " + in("id", scope.generationJobs()) + " AND status='running'")
                + store.count("SELECT COUNT(*) FROM workspace_ai_grading_jobs WHERE " + in("id", scope.gradingJobs()) + " AND status='running'")
                + store.count("SELECT COUNT(*) FROM notification_outbox WHERE " + in("id", scope.notifications()) + " AND status='processing'");
        if (running > 0) blockers.add("Има AI заявки или известия в процес на обработка. Изчакайте обработката да приключи и опитайте отново.");
        long billing = store.count("SELECT COUNT(*) FROM stripe_subscription_bindings WHERE " + in("organization_id", scope.personalOrganizations()))
                + store.count("SELECT COUNT(*) FROM stripe_checkout_requests WHERE " + in("organization_id", scope.personalOrganizations()))
                + store.count("SELECT COUNT(*) FROM workspace_billing_events WHERE " + in("organization_id", scope.personalOrganizations()));
        if (billing > 0) blockers.add("Личното пространство има платежни записи или Stripe връзка. Уредете абонамента и платежната история преди изтриване.");
        if (hasRetainedImageReferences(scope)) blockers.add("Изображения на потребителя се използват в запазени тестове, резултати или лого на друга организация. Заменете тези изображения преди изтриване.");
        for (long org : scope.organizations()) {
            if (scope.personalOrganizations().contains(org)) continue;
            long reservations = reservationsToRelease(scope, org);
            if (reservations > 0 && store.count("SELECT COUNT(*) FROM organization_subscriptions WHERE organization_id=? AND ai_reserved>=?", org, reservations) == 0) {
                blockers.add("AI резервациите на организацията трябва да бъдат сверени преди изтриване.");
                break;
            }
        }
        return blockers;
    }

    private boolean hasRetainedImageReferences(Scope scope) {
        if (scope.images().isEmpty()) return false;
        if (store.count("SELECT COUNT(*) FROM organizations WHERE " + in("logo_id", scope.images()) + " AND NOT (" + in("id", scope.personalOrganizations()) + ")") > 0) return true;
        Set<Long> images = Set.copyOf(scope.images());
        for (var row : store.rows("SELECT definition_json content FROM workspace_assessments WHERE NOT (" + in("id", scope.assessments()) + ")")) if (referencesImage(json.object(row.get("content")), images)) return true;
        for (var row : store.rows("SELECT definition_json content FROM assessment_versions WHERE NOT (" + in("id", scope.versions()) + ")")) if (referencesImage(json.object(row.get("content")), images)) return true;
        for (var row : store.rows("SELECT definition_json content FROM question_bank_items WHERE NOT (" + in("id", scope.bankItems()) + ")")) if (referencesImage(json.object(row.get("content")), images)) return true;
        for (var row : store.rows("SELECT definition_json content FROM attempt_questions WHERE NOT (" + in("attempt_id", scope.attempts()) + ")")) if (referencesImage(json.object(row.get("content")), images)) return true;
        for (var row : store.rows("SELECT snapshot_json content FROM result_revisions WHERE NOT (" + in("attempt_id", scope.attempts()) + ")")) if (referencesImage(json.object(row.get("content")), images)) return true;
        for (var row : store.rows("SELECT result_json content FROM workspace_ai_jobs WHERE result_json IS NOT NULL AND NOT (" + in("id", scope.generationJobs()) + ")")) if (referencesImage(json.object(row.get("content")), images)) return true;
        return false;
    }

    private boolean referencesImage(Object value, Set<Long> images) {
        if (value instanceof Map<?, ?> map) {
            Object image = map.get("imageId");
            if (image instanceof Number id && images.contains(id.longValue())) return true;
            for (Object child : map.values()) if (referencesImage(child, images)) return true;
        } else if (value instanceof Collection<?> collection) {
            for (Object child : collection) if (referencesImage(child, images)) return true;
        }
        return false;
    }

    private void releaseReservations(Scope scope) {
        for (long org : scope.organizations()) {
            if (scope.personalOrganizations().contains(org)) continue;
            long reservations = reservationsToRelease(scope, org);
            if (reservations > 0 && store.update("UPDATE organization_subscriptions SET ai_reserved=ai_reserved-? WHERE organization_id=? AND ai_reserved>=?", reservations, org, reservations) != 1) {
                throw new IllegalStateException("AI reservation settlement changed during account deletion");
            }
        }
    }

    private long reservationsToRelease(Scope scope, long org) {
        return store.count("SELECT COUNT(*) FROM workspace_ai_jobs WHERE organization_id=? AND status='queued' AND " + in("id", scope.generationJobs()), org)
                + store.count("SELECT COUNT(*) FROM workspace_ai_grading_jobs WHERE organization_id=? AND quota_reserved=TRUE AND " + in("id", scope.gradingJobs()), org);
    }

    private Scope collect(long userId) {
        List<Long> personal = ids("SELECT organization_id id FROM personal_workspaces WHERE user_id=? ORDER BY organization_id", userId);
        List<Long> organizations = ids("SELECT organization_id id FROM memberships WHERE user_id=? UNION SELECT organization_id id FROM personal_workspaces WHERE user_id=? UNION SELECT organization_id id FROM support_grants WHERE administrator_id=? UNION SELECT organization_id id FROM notification_outbox WHERE user_id=? AND organization_id IS NOT NULL UNION SELECT organization_id id FROM workspace_audit WHERE actor_id=? AND organization_id IS NOT NULL ORDER BY id", userId, userId, userId, userId, userId);
        List<Long> assessments = ids("SELECT id FROM workspace_assessments WHERE owner_id=? OR " + in("organization_id", personal) + " ORDER BY id", userId);
        List<Long> versions = ids("SELECT id FROM assessment_versions WHERE " + in("assessment_id", assessments) + " ORDER BY id");
        List<Long> assignments = ids("SELECT id FROM exam_assignments WHERE teacher_id=? OR " + in("organization_id", personal) + " ORDER BY id", userId);
        List<Long> attempts = ids("SELECT id FROM exam_attempts WHERE student_id=? OR " + in("organization_id", personal) + " OR " + in("assignment_id", assignments) + " ORDER BY id", userId);
        List<Long> groups = ids("SELECT g.id FROM learning_groups g WHERE " + in("g.organization_id", personal) + " OR EXISTS (SELECT 1 FROM group_teachers t WHERE t.organization_id=g.organization_id AND t.group_id=g.id AND t.user_id=?) ORDER BY g.id", userId);
        List<Long> conversations = ids("SELECT id FROM workspace_conversations WHERE " + in("organization_id", personal) + " OR " + in("group_id", groups) + " ORDER BY id");
        List<Long> images = ids("SELECT id FROM private_images WHERE owner_id=? OR " + in("organization_id", personal) + " ORDER BY id", userId);
        List<Long> bank = ids("SELECT id FROM question_bank_items WHERE owner_id=? OR " + in("organization_id", personal) + " ORDER BY id", userId);
        List<Long> generation = ids("SELECT id FROM workspace_ai_jobs WHERE user_id=? OR " + in("organization_id", personal) + " ORDER BY id", userId);
        List<Long> grading = ids("SELECT id FROM workspace_ai_grading_jobs WHERE user_id=? OR " + in("organization_id", personal) + " OR " + in("attempt_id", attempts) + " ORDER BY id", userId);
        List<Long> notifications = ids("SELECT id FROM notification_outbox WHERE user_id=? OR " + in("organization_id", personal) + " OR revision_id IN (SELECT id FROM result_revisions WHERE " + in("attempt_id", attempts) + ") ORDER BY id", userId);
        List<Long> legacyTests = ids("SELECT id FROM tests WHERE owner_id=? ORDER BY id", userId);
        List<Long> legacyAttempts = ids("SELECT id FROM attempt WHERE user_id=? OR " + in("test_id", legacyTests) + " ORDER BY id", userId);
        List<Long> legacyQuestions = ids("SELECT id FROM question WHERE " + in("test_id", legacyTests) + " ORDER BY id");
        return new Scope(userId, personal, organizations, assessments, versions, assignments, attempts, groups,
                conversations, images, bank, generation, grading, notifications, legacyTests, legacyAttempts, legacyQuestions);
    }

    private List<Long> ids(String sql, Object... args) {
        return store.rows(sql, args).stream().map(row -> number(row, "id")).distinct().sorted().toList();
    }

    private void lock(String table, String column, List<Long> ids) {
        if (!ids.isEmpty()) store.rows("SELECT " + column + " FROM " + table + " WHERE " + in(column, ids) + " ORDER BY " + column + " FOR UPDATE");
    }

    private void delete(String table, String column, List<Long> ids) {
        if (!ids.isEmpty()) store.update("DELETE FROM " + table + " WHERE " + in(column, ids));
    }

    // Only numeric IDs read from the database enter these fixed, repository-owned table predicates.
    // Capturing IDs before deletion also avoids MySQL 5.7's same-target-table subquery restriction.
    private String in(String column, List<Long> ids) {
        return ids.isEmpty() ? "1=0" : column + " IN (" + ids.stream().map(String::valueOf).collect(Collectors.joining(",")) + ")";
    }

    private record Scope(long userId, List<Long> personalOrganizations, List<Long> organizations,
                         List<Long> assessments, List<Long> versions, List<Long> assignments, List<Long> attempts,
                         List<Long> groups, List<Long> conversations, List<Long> images, List<Long> bankItems,
                         List<Long> generationJobs, List<Long> gradingJobs, List<Long> notifications,
                         List<Long> legacyTests, List<Long> legacyAttempts, List<Long> legacyQuestions) {}
}
