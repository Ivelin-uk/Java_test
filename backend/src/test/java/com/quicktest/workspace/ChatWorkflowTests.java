package com.quicktest.workspace;

import com.quicktest.auth.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.time.Instant;
import java.math.BigDecimal;
import java.util.*;
import java.util.concurrent.*;

import static com.quicktest.workspace.WorkspaceValues.*;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(properties={"app.legacy-api.enabled=false","app.workspace.workers=false","app.workspace.demo-seed=false"})
class ChatWorkflowTests {
    @DynamicPropertySource static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> "jdbc:h2:mem:chat_workflows;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1");
    }
    @Autowired ChatService chat;
    @Autowired ChatRealtimeHub hub;
    @Autowired WorkspaceStore db;
    @Autowired PersonalWorkspace personal;
    @Autowired OrganizationService organizations;
    @Autowired IdentityWorkflow identity;
    @Autowired AppUserRepository users;
    @Autowired PasswordEncoder passwords;
    @Autowired AuthService auth;
    @Autowired WorkspaceCrypto crypto;
    @Autowired AssessmentService assessments;
    @Autowired AssignmentService assignments;
    @Autowired AttemptService attempts;
    AppUser teacher, student, outsider;
    OrgAccess.Scope teaching, learning;
    long group, conversation;

    @BeforeEach void prepare() {
        teacher = user(Role.TEACHER);
        student = user(Role.STUDENT);
        outsider = user(Role.STUDENT);
        teaching = scope(teacher);
        learning = scope(student);
        var created = organizations.createGroup(teaching, new OrganizationService.GroupRequest("Chat group", "", "Java"));
        group = number(created, "id");
        conversation = chat.openGroup(teaching, group).id();
        organizations.joinGroup(learning, string(created, "join_code"), "127.0.0.1");
    }

    private AppUser user(Role role) {
        AppUser user = new AppUser();
        user.setName(role.name());
        user.setEmail(UUID.randomUUID() + "@example.test");
        user.setRole(role);
        user.setEmailVerifiedAt(Instant.now());
        user.setPasswordHash(passwords.encode("password123"));
        users.saveAndFlush(user);
        identity.initialize(user);
        return user;
    }
    private OrgAccess.Scope scope(AppUser user) {
        return new OrgAccess.Scope(personal.workspace(user), user.getId(), Set.of(user.getRole().name()), true);
    }
    private ChatService.MessageRequest request(String text) {
        return new ChatService.MessageRequest(text, null, UUID.randomUUID().toString());
    }
    private String session(AppUser user) {
        return "Bearer " + auth.login(new AuthService.LoginRequest(user.getEmail(), "password123")).token();
    }

    @Test void personalScopesDiscoverSharedGroupAndGlobalDirectConversation() {
        assertNotEquals(teaching.organizationId(), learning.organizationId());
        assertTrue(chat.groups(learning).stream().anyMatch(row -> number(row,"id") == group));
        assertTrue(chat.peers(learning).stream().anyMatch(row -> number(row,"user_id") == teacher.getId()));
        assertTrue(chat.threads(learning).stream().anyMatch(thread -> thread.id() == conversation));
        assertEquals(0, db.count("SELECT COUNT(*) FROM conversation_members WHERE conversation_id=? AND user_id=?", conversation, student.getId()));
        var direct = chat.openDirect(learning, teacher.getId());
        assertEquals(direct.id(), chat.openDirect(teaching, student.getId()).id());
        assertEquals("STUDENT", chat.threads(teaching).stream().filter(thread -> thread.id() == direct.id()).findFirst().orElseThrow().title());
        assertTrue(chat.threads(scope(outsider)).isEmpty());
        assertThrows(WorkspaceError.class, () -> chat.messages(scope(outsider), conversation, null));
        assertTrue(chat.peers(learning).stream().anyMatch(row -> number(row,"user_id") == outsider.getId()));
        var unrelatedDirect = chat.openDirect(learning, outsider.getId());
        assertEquals(unrelatedDirect.id(), chat.openDirect(scope(outsider), student.getId()).id());
        var message = chat.send(learning, unrelatedDirect.id(), request("Across personal workspaces"));
        assertEquals(List.of(message.id()), chat.messages(scope(outsider), unrelatedDirect.id(), null).messages().stream().map(ChatService.MessageView::id).toList());
        assertThrows(WorkspaceError.class, () -> chat.messages(teaching, unrelatedDirect.id(), null));
        var explicitOtherNamespace = new OrgAccess.Scope(learning.organizationId(), student.getId(), Set.of("STUDENT"));
        assertThrows(WorkspaceError.class, () -> chat.messages(explicitOtherNamespace, conversation, null));
    }

    @Test void concurrentOppositeDirectionDirectCreationUsesOneConversationWithoutSharingMemberships() throws Exception {
        var outsideScope = scope(outsider);
        long memberships = db.count("SELECT COUNT(*) FROM memberships WHERE user_id IN (?,?)", student.getId(), outsider.getId());
        try (ExecutorService pool = Executors.newFixedThreadPool(2)) {
            var tasks = List.<Callable<Long>>of(
                    () -> chat.openDirect(learning, outsider.getId()).id(),
                    () -> chat.openDirect(outsideScope, student.getId()).id());
            var results = pool.invokeAll(tasks);
            long id = results.getFirst().get(10, TimeUnit.SECONDS);
            assertEquals(id, results.getLast().get(10, TimeUnit.SECONDS));
            assertEquals(1, chat.threads(learning).stream().filter(thread -> thread.id() == id).count());
            assertEquals(1, chat.threads(outsideScope).stream().filter(thread -> thread.id() == id).count());
        }
        assertEquals(memberships, db.count("SELECT COUNT(*) FROM memberships WHERE user_id IN (?,?)", student.getId(), outsider.getId()));
        assertEquals(0, db.count("SELECT COUNT(*) FROM memberships WHERE organization_id=? AND user_id=?", outsideScope.organizationId(), student.getId()));
        assertEquals(0, db.count("SELECT COUNT(*) FROM memberships WHERE organization_id=? AND user_id=?", learning.organizationId(), outsider.getId()));
    }

    @Test void registeredDirectorySearchesNameAndEmailWithoutExposingSelfInactiveOrUnselectedProfiles() {
        String marker = UUID.randomUUID().toString();
        outsider.setName("Independent " + marker);
        users.saveAndFlush(outsider);
        var inactive = user(Role.TEACHER);
        inactive.setName(marker);
        inactive.setActive(false);
        users.saveAndFlush(inactive);
        var unselected = user(Role.STUDENT);
        unselected.setName(marker);
        unselected.setRoleSelectionRequired(true);
        users.saveAndFlush(unselected);

        var matchingName = chat.peers(learning, "INDEPENDENT " + marker);
        assertEquals(List.of(outsider.getId()), matchingName.stream().map(row -> number(row, "user_id")).toList());
        assertEquals(outsider.getEmail(), string(matchingName.getFirst(), "email"));
        assertEquals("STUDENT", string(matchingName.getFirst(), "role"));
        assertEquals(List.of(outsider.getId()), chat.peers(learning, outsider.getEmail().toUpperCase(Locale.ROOT)).stream().map(row -> number(row, "user_id")).toList());
        assertTrue(chat.peers(learning, student.getEmail()).isEmpty());
        assertEquals(List.of(outsider.getId()), chat.peers(learning, marker).stream().map(row -> number(row, "user_id")).toList());
        assertThrows(WorkspaceError.class, () -> chat.openDirect(learning, inactive.getId()));
        assertThrows(WorkspaceError.class, () -> chat.openDirect(learning, unselected.getId()));
        assertThrows(WorkspaceError.class, () -> chat.openDirect(learning, student.getId()));
        assertThrows(WorkspaceError.class, () -> chat.openDirect(learning, Long.MAX_VALUE));
    }

    @Test void administratorsAreDiscoverableAndCanJoinDirectChatsWithoutBypassingPrivacy() {
        var admin = user(Role.ADMIN);
        var adminScope = scope(admin);
        assertEquals(List.of(admin.getId()), chat.peers(learning, admin.getEmail()).stream().map(row -> number(row, "user_id")).toList());
        assertEquals(List.of(student.getId()), chat.peers(adminScope, student.getEmail()).stream().map(row -> number(row, "user_id")).toList());
        var direct = chat.openDirect(adminScope, student.getId());
        assertEquals(direct.id(), chat.openDirect(learning, admin.getId()).id());
        var message = chat.send(adminScope, direct.id(), request("Admin is a participant"));
        assertEquals(message.id(), chat.messages(learning, direct.id(), null).messages().getFirst().id());
        var privateDirect = chat.openDirect(teaching, outsider.getId());
        assertThrows(WorkspaceError.class, () -> chat.messages(adminScope, privateDirect.id(), null));
        assertThrows(WorkspaceError.class, () -> chat.messages(adminScope, conversation, null));
        var custom = chat.createCustomGroup(adminScope, new ChatService.CustomGroupRequest("Admin discussion", List.of(student.getId(), teacher.getId())));
        assertEquals("group", custom.type());
        chat.send(adminScope, custom.id(), request("Included administrator"));
        assertEquals(1, chat.messages(learning, custom.id(), null).messages().size());
        assertThrows(WorkspaceError.class, () -> chat.messages(scope(outsider), custom.id(), null));
    }

    @Test void customGroupSupportsUnrelatedParticipantsAndKeepsHistoryFilesReadsAndTicketsPrivate() {
        var outsideScope = scope(outsider);
        var nonmember = scope(user(Role.ADMIN));
        long memberships = db.count("SELECT COUNT(*) FROM memberships WHERE user_id IN (?,?,?)", teacher.getId(), student.getId(), outsider.getId());
        var custom = chat.createCustomGroup(teaching, new ChatService.CustomGroupRequest("  Independent discussion  ", List.of(student.getId(), outsider.getId())));
        assertEquals("group", custom.type());
        assertNull(custom.groupId());
        assertNull(custom.peerId());
        assertEquals("Independent discussion", custom.title());
        var explicitlyScopedCreator = new OrgAccess.Scope(teaching.organizationId(), teacher.getId(), Set.of("TEACHER"));
        assertThrows(WorkspaceError.class, () -> chat.messages(explicitlyScopedCreator, custom.id(), null));
        assertThrows(WorkspaceError.class, () -> chat.createCustomGroup(explicitlyScopedCreator,
                new ChatService.CustomGroupRequest("Scoped group", List.of(student.getId(), outsider.getId()))));
        assertEquals(memberships, db.count("SELECT COUNT(*) FROM memberships WHERE user_id IN (?,?,?)", teacher.getId(), student.getId(), outsider.getId()));
        for (var member : List.of(teaching, learning, outsideScope)) {
            assertEquals(1, chat.threads(member).stream().filter(thread -> thread.id() == custom.id()).count());
        }
        assertTrue(chat.threads(nonmember).stream().noneMatch(thread -> thread.id() == custom.id()));
        var attachment = new ChatService.AttachmentRequest("shared.txt", Base64.getEncoder().encodeToString("private notes".getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        var first = chat.send(teaching, custom.id(), new ChatService.MessageRequest("First", attachment));
        var second = chat.send(outsideScope, custom.id(), request("Second"));
        assertEquals(List.of(first.id(), second.id()), chat.messages(learning, custom.id(), null).messages().stream().map(ChatService.MessageView::id).toList());
        assertArrayEquals("private notes".getBytes(java.nio.charset.StandardCharsets.UTF_8), chat.attachment(outsideScope, custom.id(), first.id()).content());
        assertEquals(2, chat.threads(learning).stream().filter(thread -> thread.id() == custom.id()).findFirst().orElseThrow().unreadCount());
        chat.markRead(learning, custom.id(), new ChatService.ReadRequest(first.id()));
        assertEquals(1, chat.threads(learning).stream().filter(thread -> thread.id() == custom.id()).findFirst().orElseThrow().unreadCount());
        assertThrows(WorkspaceError.class, () -> chat.messages(nonmember, custom.id(), null));
        assertThrows(WorkspaceError.class, () -> chat.send(nonmember, custom.id(), request("Intrusion")));
        assertThrows(WorkspaceError.class, () -> chat.attachment(nonmember, custom.id(), first.id()));
        assertThrows(WorkspaceError.class, () -> chat.markRead(nonmember, custom.id(), new ChatService.ReadRequest(first.id())));

        String authorization = session(outsider), differentSession = session(outsider);
        String ticket = chat.issueRealtimeTicket(outsideScope, custom.id(), authorization);
        assertThrows(WorkspaceError.class, () -> chat.conversationEvents(outsideScope, custom.id(), differentSession, ticket));
        assertThrows(WorkspaceError.class, () -> chat.issueRealtimeTicket(nonmember, custom.id(), session(users.findById(nonmember.userId()).orElseThrow())));
        int streams = hub.subscriptionCount();
        chat.conversationEvents(outsideScope, custom.id(), authorization, ticket);
        assertEquals(streams + 1, hub.subscriptionCount());
        assertThrows(WorkspaceError.class, () -> chat.conversationEvents(outsideScope, custom.id(), authorization, ticket));
        auth.logout(authorization);
        hub.keepAlive();
        assertEquals(streams, hub.subscriptionCount());

        organizations.removeStudent(teaching, group, student.getId());
        assertThrows(WorkspaceError.class, () -> chat.messages(learning, conversation, null));
        assertEquals(2, chat.messages(learning, custom.id(), null).messages().size());
        assertEquals("Still participating", chat.send(learning, custom.id(), request("Still participating")).text());
        outsider.setActive(false);
        users.saveAndFlush(outsider);
        assertThrows(WorkspaceError.class, () -> chat.messages(outsideScope, custom.id(), null));
    }

    @Test void customGroupRejectsInvalidTitlesParticipantsAndUnavailableAccountsWithoutPersistence() {
        long before = db.count("SELECT COUNT(*) FROM workspace_conversations WHERE organization_id=?", teaching.organizationId());
        for (String title : List.of("", "   ", "x".repeat(191))) {
            assertEquals(400, assertThrows(WorkspaceError.class, () -> chat.createCustomGroup(teaching,
                    new ChatService.CustomGroupRequest(title, List.of(student.getId(), outsider.getId())))).getStatusCode().value());
        }
        List<List<Long>> invalidParticipants = List.of(List.of(), List.of(student.getId()),
                List.of(student.getId(), student.getId()), List.of(student.getId(), teacher.getId()),
                List.of(student.getId(), 0L), java.util.stream.LongStream.rangeClosed(1, 50).boxed().toList());
        for (var recipients : invalidParticipants) {
            assertEquals(400, assertThrows(WorkspaceError.class, () -> chat.createCustomGroup(teaching,
                    new ChatService.CustomGroupRequest("Invalid group", recipients))).getStatusCode().value());
        }
        assertEquals(400, assertThrows(WorkspaceError.class, () -> chat.createCustomGroup(teaching,
                new ChatService.CustomGroupRequest(null, List.of(student.getId(), outsider.getId())))).getStatusCode().value());
        assertEquals(400, assertThrows(WorkspaceError.class, () -> chat.createCustomGroup(teaching,
                new ChatService.CustomGroupRequest("Invalid group", null))).getStatusCode().value());
        assertEquals(403, assertThrows(WorkspaceError.class, () -> chat.createCustomGroup(teaching,
                new ChatService.CustomGroupRequest("Unknown participant", List.of(student.getId(), Long.MAX_VALUE)))).getStatusCode().value());
        outsider.setActive(false);
        users.saveAndFlush(outsider);
        assertEquals(403, assertThrows(WorkspaceError.class, () -> chat.createCustomGroup(teaching,
                new ChatService.CustomGroupRequest("Inactive participant", List.of(student.getId(), outsider.getId())))).getStatusCode().value());
        outsider.setActive(true);
        outsider.setRoleSelectionRequired(true);
        users.saveAndFlush(outsider);
        assertEquals(403, assertThrows(WorkspaceError.class, () -> chat.createCustomGroup(teaching,
                new ChatService.CustomGroupRequest("Unselected participant", List.of(student.getId(), outsider.getId())))).getStatusCode().value());
        assertEquals(before, db.count("SELECT COUNT(*) FROM workspace_conversations WHERE organization_id=?", teaching.organizationId()));
    }

    @Test void idempotentRetriesReturnOneMessageAndRejectDifferentContent() {
        String key = UUID.randomUUID().toString();
        var sent = chat.send(teaching, conversation, new ChatService.MessageRequest("hello", null, key));
        var retry = chat.send(teaching, conversation, new ChatService.MessageRequest("hello", null, key));
        assertEquals(sent.id(), retry.id());
        assertEquals(key, retry.clientMessageId());
        assertEquals(1, db.count("SELECT COUNT(*) FROM workspace_messages WHERE conversation_id=?", conversation));
        assertEquals(409, assertThrows(WorkspaceError.class,
                () -> chat.send(teaching, conversation, new ChatService.MessageRequest("different", null, key))).getStatusCode().value());
    }

    @Test void concurrentRetriesCommitOneMessageAndOneId() throws Exception {
        var request = request("one message");
        try (ExecutorService pool = Executors.newFixedThreadPool(2)) {
            var tasks = List.<Callable<Long>>of(() -> chat.send(teaching, conversation, request).id(), () -> chat.send(teaching, conversation, request).id());
            var results = pool.invokeAll(tasks);
            assertEquals(results.get(0).get(10, TimeUnit.SECONDS), results.get(1).get(10, TimeUnit.SECONDS));
        }
        assertEquals(1, db.count("SELECT COUNT(*) FROM workspace_messages WHERE conversation_id=?", conversation));
    }

    @Test void reconnectCatchesUpAllPagesWithoutReadingMessages() {
        List<Long> expected = new ArrayList<>();
        for (int i=0; i<61; i++) expected.add(chat.send(teaching, conversation, request("message "+i)).id());
        var first = chat.messages(learning, conversation, null, 0L);
        assertEquals(50, first.messages().size());
        assertTrue(first.hasMore());
        assertNull(first.beforeId());
        var second = chat.messages(learning, conversation, null, first.afterId());
        assertEquals(11, second.messages().size());
        assertFalse(second.hasMore());
        List<Long> actual = new ArrayList<>(first.messages().stream().map(ChatService.MessageView::id).toList());
        actual.addAll(second.messages().stream().map(ChatService.MessageView::id).toList());
        assertEquals(expected, actual);
        assertEquals(61, chat.threads(learning).getFirst().unreadCount());
        var latest = chat.messages(learning, conversation, null);
        assertEquals(expected.subList(11, 61), latest.messages().stream().map(ChatService.MessageView::id).toList());
        var older = chat.messages(learning, conversation, latest.beforeId());
        assertEquals(expected.subList(0, 11), older.messages().stream().map(ChatService.MessageView::id).toList());
        assertThrows(WorkspaceError.class, () -> chat.messages(learning, conversation, 1L, 1L));
    }

    @Test void readCursorOnlyAdvancesToVisibleMessageAndNeverAnotherConversation() {
        var first = chat.send(teaching, conversation, request("first"));
        var second = chat.send(teaching, conversation, request("second"));
        chat.markRead(learning, conversation, new ChatService.ReadRequest(first.id()));
        assertEquals(1, chat.threads(learning).getFirst().unreadCount());
        var other = chat.openDirect(teaching, student.getId());
        var elsewhere = chat.send(teaching, other.id(), request("elsewhere"));
        assertThrows(WorkspaceError.class, () -> chat.markRead(learning, conversation, new ChatService.ReadRequest(elsewhere.id())));
        chat.markRead(learning, conversation, new ChatService.ReadRequest(second.id()));
        chat.markRead(learning, conversation, new ChatService.ReadRequest(first.id()));
        assertEquals(0, chat.threads(learning).stream().filter(thread -> thread.id() == conversation).findFirst().orElseThrow().unreadCount());
    }

    @Test void membershipRevocationProtectsExistingHistoryAttachmentsAndTicket() {
        var attachment = new ChatService.AttachmentRequest("notes.txt", Base64.getEncoder().encodeToString("notes".getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        var message = chat.send(teaching, conversation, new ChatService.MessageRequest("", attachment));
        String authorization = session(student);
        String ticket = chat.issueRealtimeTicket(learning, conversation, authorization);
        organizations.removeStudent(teaching, group, student.getId());
        assertTrue(chat.threads(learning).isEmpty());
        assertThrows(WorkspaceError.class, () -> chat.messages(learning, conversation, null));
        assertThrows(WorkspaceError.class, () -> chat.attachment(learning, conversation, message.id()));
        assertThrows(WorkspaceError.class, () -> chat.conversationEvents(learning, conversation, authorization, ticket));
    }

    @Test void accountTicketsAreSessionBoundSingleUseAndStreamsCloseAfterLogout() {
        String first = session(student), second = session(student);
        String ticket = chat.issueAccountRealtimeTicket(learning, first);
        assertThrows(WorkspaceError.class, () -> chat.accountEvents(learning, second, ticket));
        int before = hub.subscriptionCount();
        chat.accountEvents(learning, first, ticket);
        assertEquals(before+1, hub.subscriptionCount());
        assertThrows(WorkspaceError.class, () -> chat.accountEvents(learning, first, ticket));
        auth.logout(first);
        hub.keepAlive();
        assertEquals(before, hub.subscriptionCount());
    }

    @Test void expiredAccountTicketCannotBeConsumed() {
        String authorization = session(student);
        String ticket = chat.issueAccountRealtimeTicket(learning, authorization);
        db.update("UPDATE chat_account_tickets SET expires_at=? WHERE token_hash=?", Instant.now().minusSeconds(1), crypto.hash(ticket));
        assertThrows(WorkspaceError.class, () -> chat.accountEvents(learning, authorization, ticket));
    }
    @Test void changingTeacherRoleRevokesObsoleteLearningGroupButPreservesGlobalDirectAccess() {
        long direct = chat.openDirect(teaching, student.getId()).id();
        teacher.setRole(Role.STUDENT);
        users.saveAndFlush(teacher);
        assertTrue(chat.peers(learning).stream().anyMatch(row -> number(row,"user_id") == teacher.getId()));
        assertTrue(chat.threads(learning).stream().anyMatch(thread -> thread.id() == direct));
        assertEquals(direct, chat.openDirect(learning, teacher.getId()).id());
        var formerTeacher = new OrgAccess.Scope(teaching.organizationId(), teacher.getId(), Set.of("STUDENT"), true);
        assertTrue(chat.groups(formerTeacher).isEmpty());
        assertThrows(WorkspaceError.class, () -> chat.messages(formerTeacher, conversation, null));
    }

    @Test void activeExamInAnotherWorkspaceBlocksChatAndClosesExistingStream() {
        String authorization = session(student);
        int before = hub.subscriptionCount();
        chat.accountEvents(learning, authorization, chat.issueAccountRealtimeTicket(learning, authorization));
        assertEquals(before+1, hub.subscriptionCount());
        var question = new AssessmentService.Question("SINGLE_CHOICE", "Pick", "EASY", BigDecimal.ONE, 30,
                List.of(new AssessmentService.Option("yes", true), new AssessmentService.Option("no", false)),
                List.of(), true, true, "", "");
        var definition = new AssessmentService.Definition("Exam", "", "", "", "Instructions", "bg", "bulgarian",
                new BigDecimal("50"), List.of(question));
        long test = number(assessments.save(teaching, null, definition), "id");
        long version = number(assessments.publish(teaching, test), "id");
        Instant now = Instant.now();
        var assignment = assignments.create(teaching, new AssignmentService.AssignmentRequest(version, List.of(group), List.of(),
                now.minusSeconds(5), now.plusSeconds(3600), 1, false, false, true));
        var examScope = new OrgAccess.Scope(teaching.organizationId(), student.getId(), Set.of("STUDENT"), true);
        attempts.start(examScope, number(assignment, "id"), new AttemptService.StartRequest(string(assignment, "code"),
                UUID.randomUUID().toString(), UUID.randomUUID().toString(), "a".repeat(43), true, true, true), authorization, "127.0.0.1");
        assertEquals(409, assertThrows(WorkspaceError.class, () -> chat.messages(learning, conversation, null)).getStatusCode().value());
        assertThrows(WorkspaceError.class, () -> chat.send(learning, conversation, request("forbidden during exam")));
        assertThrows(WorkspaceError.class, () -> chat.issueAccountRealtimeTicket(learning, authorization));
        hub.keepAlive();
        assertEquals(before, hub.subscriptionCount());
        assertEquals(0, db.count("SELECT COUNT(*) FROM workspace_messages WHERE conversation_id=?", conversation));
    }

}
