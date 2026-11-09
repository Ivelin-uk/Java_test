package com.quicktest.workspace;

import com.quicktest.workspace.repository.ChatRepository;
import com.quicktest.workspace.repository.ExamAttemptRepository;
import com.quicktest.auth.AuthService;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import org.springframework.transaction.annotation.Isolation;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.util.*;
import static com.quicktest.workspace.WorkspaceValues.*;

@Service
public class ChatService {
    private static final int MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
    private static final int MESSAGE_PAGE_SIZE = 50;
    private final ChatRepository repository;
    private final ChatRealtimeHub realtime;
    private final WorkspaceCrypto crypto;
    private final Clock clock;
    private final AuthService auth;
    private final ExamAttemptRepository attempts;
    private final ProfileExamMutex mutex;

    public ChatService(ChatRepository repository, ChatRealtimeHub realtime, WorkspaceCrypto crypto, Clock clock, AuthService auth, ExamAttemptRepository attempts, ProfileExamMutex mutex) {
        this.repository = repository;
        this.realtime = realtime;
        this.crypto = crypto;
        this.clock = clock;
        this.auth = auth;
        this.attempts = attempts;
        this.mutex = mutex;
    }

    private static Long organizationFilter(OrgAccess.Scope scope) {
        return scope.platform() ? null : scope.organizationId();
    }

    public List<Map<String, Object>> groups(OrgAccess.Scope scope) {
        requireChatRole(scope);
        return repository.findGroups(organizationFilter(scope), scope.userId());
    }

    public List<Map<String, Object>> peers(OrgAccess.Scope scope) {
        return peers(scope, null);
    }

    public List<Map<String, Object>> peers(OrgAccess.Scope scope, String query) {
        requireChatRole(scope);
        if (scope.platform()) return repository.findRegisteredPeers(scope.userId(), query == null ? "" : query.trim());
        return repository.findPeers(organizationFilter(scope), scope.userId());
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public ThreadView openGroup(OrgAccess.Scope scope, long groupId) {
        requireChatRole(scope);
        var group = repository.requireGroup(organizationFilter(scope), groupId);
        long org = number(group, "organization_id");
        repository.lockGroup(org, groupId);
        if (!repository.isActiveMember(org, scope.userId()) || !repository.isGroupParticipant(org, groupId, scope.userId())) throw WorkspaceError.forbidden();
        var existing = repository.findGroupConversation(org, groupId);
        long conversationId = existing.map(row -> number(row, "id"))
                .orElseGet(() -> repository.insertGroupConversation(org, groupId, string(group, "name")));
        repository.addCurrentGroupParticipants(org, groupId, conversationId);
        if (existing.isEmpty()) afterCommit(() -> realtime.publish(org, conversationId, 0));
        return new ThreadView(conversationId, "group", groupId, null, string(group, "name"), null, null, null, 0, null);
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public ThreadView openDirect(OrgAccess.Scope scope, long peerId) {
        requireChatRole(scope);
        if (peerId == scope.userId()) throw WorkspaceError.forbidden();
        if (scope.platform()) return openRegisteredDirect(scope, peerId);
        var connection = repository.findPeerConnection(organizationFilter(scope), scope.userId(), peerId).orElseThrow(WorkspaceError::forbidden);
        long org = number(connection, "organization_id");
        repository.lockDirectPair(org, scope.userId(), peerId);
        if (!repository.findPeerConnection(org, scope.userId(), peerId).isPresent()) throw WorkspaceError.forbidden();
        String directKey = directKey(scope.userId(), peerId);
        var existing = repository.findDirectConversation(org, directKey);
        String title = repository.findPeers(org, scope.userId()).stream().filter(peer -> number(peer, "user_id") == peerId)
                .map(peer -> string(peer, "name")).findFirst().orElseThrow(WorkspaceError::forbidden);
        long conversationId = existing.map(row -> number(row, "id"))
                .orElseGet(() -> repository.insertDirectConversation(org, directKey, title));
        repository.addConversationMember(org, conversationId, scope.userId());
        repository.addConversationMember(org, conversationId, peerId);
        if (existing.isEmpty()) afterCommit(() -> realtime.publish(org, conversationId, 0));
        return new ThreadView(conversationId, "direct", null, peerId, title, null, null, null, 0, null);
    }

    private ThreadView openRegisteredDirect(OrgAccess.Scope scope, long peerId) {
        if (peerId < 1) throw WorkspaceError.validation("Невалиден потребител.");
        repository.lockRegisteredUsers(List.of(scope.userId(), peerId));
        var peer = repository.findRegisteredUser(peerId).orElseThrow(WorkspaceError::forbidden);
        if (!repository.isRegisteredUser(scope.userId())) throw WorkspaceError.forbidden();
        String key = directKey(scope.userId(), peerId);
        var existing = repository.findRegisteredDirectConversation(key);
        if (existing.isEmpty()) existing = repository.findLegacyDirectConversation(key, scope.userId(), peerId);
        long org = existing.map(row -> number(row, "organization_id")).orElse(scope.organizationId());
        long conversationId;
        boolean created = existing.isEmpty();
        if (created) conversationId = repository.insertRegisteredConversation(org, "registered_direct", key, string(peer, "name"));
        else {
            conversationId = number(existing.orElseThrow(), "id");
            repository.promoteRegisteredDirect(org, conversationId, key);
        }
        repository.addConversationMember(org, conversationId, scope.userId());
        repository.addConversationMember(org, conversationId, peerId);
        if (created) afterCommit(() -> realtime.publish(org, conversationId, 0));
        return new ThreadView(conversationId, "direct", null, peerId, string(peer, "name"), null, null, null, 0, null);
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public ThreadView createCustomGroup(OrgAccess.Scope scope, @Valid CustomGroupRequest request) {
        requireChatRole(scope);
        if (!scope.platform()) throw WorkspaceError.forbidden();
        String title = request == null || request.title() == null ? "" : request.title().trim();
        List<Long> participants = request == null ? null : request.participantIds();
        if (title.isEmpty() || title.length() > 190) throw WorkspaceError.validation("Името на чата трябва да е от 1 до 190 символа.");
        if (participants == null || participants.size() < 2 || participants.size() > 49
                || participants.stream().anyMatch(id -> id == null || id < 1 || id == scope.userId())
                || new HashSet<>(participants).size() != participants.size()) {
            throw WorkspaceError.validation("Избери между 2 и 49 различни участници, без собствения си профил.");
        }
        List<Long> members = new ArrayList<>(participants);
        members.add(scope.userId());
        repository.lockRegisteredUsers(members);
        if (members.stream().anyMatch(id -> !repository.isRegisteredUser(id))) throw WorkspaceError.forbidden();
        long org = scope.organizationId();
        long conversationId = repository.insertRegisteredConversation(org, "custom_group", null, title);
        for (long member : members) repository.addConversationMember(org, conversationId, member);
        afterCommit(() -> realtime.publish(org, conversationId, 0));
        return new ThreadView(conversationId, "group", null, null, title, null, null, null, 0, null);
    }

    public List<ThreadView> threads(OrgAccess.Scope scope) {
        requireChatRole(scope);
        List<ThreadView> result = new ArrayList<>();
        for (Map<String, Object> row : repository.findThreads(organizationFilter(scope), scope.userId())) {
            if (!canAccess(scope, row)) continue;
            boolean learningGroup = row.get("group_id") != null;
            boolean customGroup = "custom_group".equals(row.get("chat_kind"));
            boolean group = learningGroup || customGroup;
            result.add(new ThreadView(number(row, "id"), group ? "group" : "direct",
                    learningGroup ? number(row, "group_id") : null,
                    group || row.get("peer_id") == null ? null : number(row, "peer_id"),
                    string(row, learningGroup ? "group_name" : customGroup ? "title" : "peer_name"), nullableString(row, "last_message"),
                    nullableString(row, "attachment_name"), nullableString(row, "last_message_at"), number(row, "unread_count"),
                    row.get("last_message_id") == null ? null : number(row, "last_message_id")));
        }
        return result;
    }

    public MessagePage messages(OrgAccess.Scope scope, long conversationId, Long beforeId) {
        return messages(scope, conversationId, beforeId, null);
    }

    public MessagePage messages(OrgAccess.Scope scope, long conversationId, Long beforeId, Long afterId) {
        var conversation = requireAccessible(scope, conversationId);
        if ((beforeId != null && beforeId < 1) || (afterId != null && afterId < 0) || (beforeId != null && afterId != null)) {
            throw WorkspaceError.validation("Невалиден курсор за историята.");
        }
        long org = number(conversation, "organization_id");
        List<Map<String, Object>> rows = afterId == null
                ? repository.findMessages(org, conversationId, beforeId, MESSAGE_PAGE_SIZE + 1)
                : repository.findMessagesAfter(org, conversationId, afterId, MESSAGE_PAGE_SIZE + 1);
        boolean hasMore = rows.size() > MESSAGE_PAGE_SIZE;
        if (hasMore) rows.removeLast();
        if (afterId == null) Collections.reverse(rows);
        List<MessageView> messages = rows.stream().map(ChatService::messageView).toList();
        Long nextBefore = afterId == null && hasMore && !rows.isEmpty() ? number(rows.getFirst(), "id") : null;
        Long nextAfter = rows.isEmpty() ? afterId : number(rows.getLast(), "id");
        return new MessagePage(messages, hasMore, nextBefore, nextAfter);
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public MessageView send(OrgAccess.Scope scope, long conversationId, @Valid MessageRequest request) {
        if (scope.roles().contains("STUDENT")) mutex.lock(scope.userId());
        var conversation = requireAccessible(scope, conversationId);
        long org = number(conversation, "organization_id");
        // Group membership changes lock the group first. Message writers then serialize on
        // the conversation so incremental cursors cannot skip a later-committing message.
        if (conversation.get("group_id") != null) repository.lockGroup(org, number(conversation, "group_id"));
        repository.lockConversation(org, conversationId);
        requireAccessible(scope, conversationId);
        String text = request == null || request.text() == null ? "" : request.text().trim();
        PreparedAttachment attachment = request == null ? null : prepareAttachment(request.attachment());
        if (text.isEmpty() && attachment == null) throw WorkspaceError.validation("Напиши съобщение или добави файл.");
        if (text.length() > 4000) throw WorkspaceError.validation("Съобщението трябва да е до 4000 символа.");
        String clientId = request == null ? null : request.clientMessageId();
        if (clientId != null) {
            try {
                if (!UUID.fromString(clientId).toString().equalsIgnoreCase(clientId)) throw new IllegalArgumentException();
                clientId = clientId.toLowerCase(Locale.ROOT);
            } catch (IllegalArgumentException invalidId) { throw WorkspaceError.validation("Невалиден идентификатор на съобщението."); }
        }
        String attachmentFingerprint = attachment == null ? "0" : "1" + attachment.fileName().length() + ":" + attachment.fileName()
                + attachment.contentType().length() + ":" + attachment.contentType() + crypto.hash(Base64.getEncoder().encodeToString(attachment.content()));
        String requestHash = crypto.hash(text.length() + ":" + text + attachmentFingerprint);
        if (clientId != null) {
            var existing = repository.findMessageByClientId(org, conversationId, scope.userId(), clientId);
            if (existing.isPresent()) {
                if (!requestHash.equals(string(existing.get(), "request_hash"))) throw WorkspaceError.conflict("Това съобщение вече е изпратено с различно съдържание.");
                return messageView(repository.requireMessage(org, conversationId, number(existing.get(), "id")));
            }
        }
        repository.addConversationMember(org, conversationId, scope.userId());
        long messageId = repository.insertMessage(org, conversationId, scope.userId(), text,
                attachment == null ? null : attachment.fileName(), attachment == null ? null : attachment.contentType(),
                attachment == null ? null : attachment.content().length, attachment == null ? null : attachment.content(),
                clock.instant(), clientId, requestHash);
        MessageView result = messageView(repository.requireMessage(org, conversationId, messageId));
        afterCommit(() -> realtime.publish(org, conversationId, messageId));
        return result;
    }

    @Transactional
    public void markRead(OrgAccess.Scope scope, long conversationId) { markRead(scope, conversationId, null); }

    @Transactional
    public void markRead(OrgAccess.Scope scope, long conversationId, ReadRequest request) {
        var conversation = requireAccessible(scope, conversationId);
        long org = number(conversation, "organization_id");
        long messageId = request == null || request.messageId() == null ? repository.lastMessageId(org, conversationId) : request.messageId();
        if (messageId < 0) throw WorkspaceError.validation("Невалидно съобщение.");
        if (messageId > 0) repository.requireMessage(org, conversationId, messageId);
        repository.addConversationMember(org, conversationId, scope.userId());
        if (repository.markRead(org, conversationId, scope.userId(), messageId) > 0) {
            afterCommit(() -> realtime.read(org, conversationId, scope.userId()));
        }
    }

    public ChatRepository.Attachment attachment(OrgAccess.Scope scope, long conversationId, long messageId) {
        var conversation = requireAccessible(scope, conversationId);
        return repository.requireAttachment(number(conversation, "organization_id"), conversationId, messageId);
    }

    @Transactional
    public String issueRealtimeTicket(OrgAccess.Scope scope, long conversationId, String authorization) {
        var conversation = requireAccessible(scope, conversationId);
        requireSession(scope, authorization);
        long org = number(conversation, "organization_id");
        repository.addConversationMember(org, conversationId, scope.userId());
        String ticket = crypto.token();
        repository.insertRealtimeTicket(crypto.hash(ticket), org, conversationId, scope.userId(), crypto.hash(authorization), clock.instant().plusSeconds(60));
        return ticket;
    }

    public void consumeRealtimeTicket(OrgAccess.Scope scope, long conversationId, String authorization, String ticket) {
        var conversation = requireAccessible(scope, conversationId);
        requireSession(scope, authorization);
        if (ticket == null || ticket.isBlank() || !repository.consumeRealtimeTicket(crypto.hash(ticket), number(conversation, "organization_id"),
                conversationId, scope.userId(), crypto.hash(authorization), clock.instant())) throw WorkspaceError.forbidden();
    }

    @Transactional
    public String issueAccountRealtimeTicket(OrgAccess.Scope scope, String authorization) {
        requireChatRole(scope);
        requireSession(scope, authorization);
        String ticket = crypto.token();
        repository.insertAccountRealtimeTicket(crypto.hash(ticket), scope.organizationId(), scope.userId(), crypto.hash(authorization), clock.instant().plusSeconds(60));
        return ticket;
    }

    public SseEmitter accountEvents(OrgAccess.Scope scope, String authorization, String ticket) {
        requireChatRole(scope);
        requireSession(scope, authorization);
        if (ticket == null || ticket.isBlank() || !repository.consumeAccountRealtimeTicket(crypto.hash(ticket), scope.organizationId(), scope.userId(),
                crypto.hash(authorization), clock.instant())) throw WorkspaceError.forbidden();
        return subscribe(scope, authorization, null);
    }

    public SseEmitter conversationEvents(OrgAccess.Scope scope, long conversationId, String authorization, String ticket) {
        consumeRealtimeTicket(scope, conversationId, authorization, ticket);
        return subscribe(scope, authorization, conversationId);
    }

    private SseEmitter subscribe(OrgAccess.Scope scope, String authorization, Long conversationId) {
        return realtime.subscribe(scope.organizationId(), scope.userId(), conversationId, scope.platform(),
                () -> sessionValid(scope, authorization) && (conversationId == null || canReceive(scope, conversationId)),
                (org, conversation) -> (scope.platform() || scope.organizationId() == org) && canReceive(scope, conversation));
    }

    private boolean sessionValid(OrgAccess.Scope scope, String authorization) {
        try {
            var user = auth.requireUser(authorization);
            return user.getId() == scope.userId() && !user.isRoleSelectionRequired()
                    && (user.getRole() != com.quicktest.auth.Role.STUDENT || attempts.countActiveStudentAttempts(scope.userId()) == 0)
                    && repository.isActiveMember(scope.organizationId(), scope.userId());
        } catch (RuntimeException denied) { return false; }
    }

    private void requireSession(OrgAccess.Scope scope, String authorization) {
        if (!sessionValid(scope, authorization)) throw WorkspaceError.forbidden();
    }

    private boolean canReceive(OrgAccess.Scope scope, long conversationId) {
        try { requireChatRole(scope); return canAccess(scope, repository.requireConversation(organizationFilter(scope), conversationId)); }
        catch (WorkspaceError missing) { return false; }
    }

    @Scheduled(fixedDelay = 60_000)
    public void expireTickets() { repository.deleteExpiredTickets(clock.instant()); }

    private Map<String, Object> requireAccessible(OrgAccess.Scope scope, long conversationId) {
        requireChatRole(scope);
        var conversation = repository.requireConversation(organizationFilter(scope), conversationId);
        if (!canAccess(scope, conversation)) throw WorkspaceError.forbidden();
        return conversation;
    }

    private boolean canAccess(OrgAccess.Scope scope, Map<String, Object> conversation) {
        long org = number(conversation, "organization_id");
        long id = number(conversation, "id");
        String kind = nullableString(conversation, "chat_kind");
        if ("registered_direct".equals(kind) || "custom_group".equals(kind)) {
            if (!scope.platform() || !repository.isRegisteredUser(scope.userId())
                    || !repository.isConversationMember(org, id, scope.userId()) || !repository.isActiveOrganization(org)) return false;
            if ("custom_group".equals(kind)) return true;
            return repository.countConversationMembers(org, id) == 2 && repository.findDirectPeer(org, id, scope.userId())
                    .filter(peer -> repository.isRegisteredUser(number(peer, "user_id"))).isPresent();
        }
        if ((!scope.platform() && org != scope.organizationId()) || !repository.isActiveMember(org, scope.userId())) return false;
        if (conversation.get("group_id") != null) return repository.isGroupParticipant(org, number(conversation, "group_id"), scope.userId());
        if (!repository.isConversationMember(org, id, scope.userId()) || repository.countConversationMembers(org, id) != 2) return false;
        return repository.findDirectPeer(org, id, scope.userId()).filter(peer -> repository.findPeerConnection(org, scope.userId(), number(peer, "user_id")).isPresent()).isPresent();
    }

    private void requireChatRole(OrgAccess.Scope scope) {
        if (!scope.roles().contains("TEACHER") && !scope.roles().contains("STUDENT") && !scope.roles().contains("ADMIN")) throw WorkspaceError.forbidden();
        if (scope.platform() && !repository.isRegisteredUser(scope.userId())) throw WorkspaceError.forbidden();
        if (scope.roles().contains("STUDENT") && attempts.countActiveStudentAttempts(scope.userId()) > 0) {
            throw WorkspaceError.conflict("Чатът е недостъпен по време на активен изпит.");
        }
    }

    private static String directKey(long first, long second) { return Math.min(first, second) + ":" + Math.max(first, second); }

    private PreparedAttachment prepareAttachment(AttachmentRequest request) {
        if (request == null) return null;
        if (request.fileName() == null || request.fileName().isBlank() || request.base64() == null
                || request.base64().length() > 14_000_000) throw WorkspaceError.validation("Невалиден файл.");
        String safeName = request.fileName().replace('\\', '/');
        safeName = safeName.substring(safeName.lastIndexOf('/') + 1).replaceAll("[\\p{Cntrl}]", "").trim();
        if (safeName.isBlank() || safeName.length() > 180) throw WorkspaceError.validation("Името на файла е невалидно или твърде дълго.");
        int extensionIndex = safeName.lastIndexOf('.');
        if (extensionIndex < 1) throw WorkspaceError.validation("Поддържат се PDF, PNG, JPG, TXT, DOCX и PPTX файлове.");
        String extension = safeName.substring(extensionIndex + 1).toLowerCase(Locale.ROOT);
        String contentType = switch (extension) {
            case "pdf" -> "application/pdf";
            case "png" -> "image/png";
            case "jpg", "jpeg" -> "image/jpeg";
            case "txt" -> "text/plain";
            case "docx" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            case "pptx" -> "application/vnd.openxmlformats-officedocument.presentationml.presentation";
            default -> throw WorkspaceError.validation("Поддържат се PDF, PNG, JPG, TXT, DOCX и PPTX файлове.");
        };
        byte[] content;
        try {
            content = Base64.getDecoder().decode(request.base64());
        } catch (IllegalArgumentException invalidBase64) {
            throw WorkspaceError.validation("Файлът не може да бъде прочетен.");
        }
        if (content.length == 0 || content.length > MAX_ATTACHMENT_BYTES || !matchesFileSignature(extension, content)) {
            throw WorkspaceError.validation("Файлът е празен, надвишава 10 MB или не съответства на формата си.");
        }
        return new PreparedAttachment(safeName, contentType, content);
    }

    private static boolean matchesFileSignature(String extension, byte[] content) {
        return switch (extension) {
            case "pdf" -> startsWith(content, "%PDF-".getBytes(StandardCharsets.US_ASCII));
            case "png" -> startsWith(content, new byte[]{(byte) 0x89, 'P', 'N', 'G', 13, 10, 26, 10});
            case "jpg", "jpeg" -> content.length >= 3 && content[0] == (byte) 0xff
                    && content[1] == (byte) 0xd8 && content[2] == (byte) 0xff;
            case "docx", "pptx" -> content.length >= 4 && content[0] == 'P' && content[1] == 'K'
                    && content[2] == 3 && content[3] == 4;
            case "txt" -> validUtf8Text(content);
            default -> false;
        };
    }

    private static boolean startsWith(byte[] value, byte[] prefix) {
        if (value.length < prefix.length) return false;
        for (int i = 0; i < prefix.length; i++) if (value[i] != prefix[i]) return false;
        return true;
    }

    private static boolean validUtf8Text(byte[] value) {
        try {
            String text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(value)).toString();
            return text.indexOf('\0') < 0;
        } catch (CharacterCodingException invalidText) {
            return false;
        }
    }

    private void afterCommit(Runnable callback) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCommit() { callback.run(); }
            });
        } else callback.run();
    }

    private static MessageView messageView(Map<String, Object> row) {
        Integer size = row.get("attachment_size") == null ? null : ((Number) row.get("attachment_size")).intValue();
        return new MessageView(number(row, "id"), number(row, "sender_id"), string(row, "sender_name"),
                string(row, "body"), nullableString(row, "attachment_name"), nullableString(row, "attachment_type"),
                size, string(row, "created_at"), nullableString(row, "client_message_id"));
    }

    private static String nullableString(Map<String, Object> row, String key) {
        return row.get(key) == null ? null : string(row, key);
    }

    public record ThreadView(long id, String type, Long groupId, Long peerId, String title, String lastMessage,
                             String attachmentName, String lastMessageAt, long unreadCount, Long latestMessageId) {}
    public record CustomGroupRequest(@NotBlank @Size(max = 190) String title,
                                     @jakarta.validation.constraints.NotNull @Size(min = 2, max = 49) List<Long> participantIds) {}
    public record MessageView(long id, long senderId, String senderName, String text, String attachmentName,
                              String attachmentType, Integer attachmentSize, String createdAt, String clientMessageId) {}
    public record MessagePage(List<MessageView> messages, boolean hasMore, Long beforeId, Long afterId) {}
    public record MessageRequest(@Size(max = 4000) String text, @Valid AttachmentRequest attachment, @Size(max = 36) String clientMessageId) {
        public MessageRequest(String text, AttachmentRequest attachment) { this(text, attachment, null); }
    }
    public record ReadRequest(Long messageId) {}
    public record AttachmentRequest(@NotBlank @Size(max = 180) String fileName,
                                    @NotBlank @Size(max = 14_000_000) String base64) {}
    private record PreparedAttachment(String fileName, String contentType, byte[] content) {}
}
