package com.quicktest.workspace;

import com.quicktest.workspace.repository.ChatRepository;
import com.quicktest.workspace.repository.ExamAttemptRepository;
import com.quicktest.auth.AuthService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.stream.LongStream;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ChatServiceTests {
    private ChatRepository repository;
    private ChatRealtimeHub realtime;
    private ChatService service;
    private final OrgAccess.Scope teacher = new OrgAccess.Scope(12, 31, Set.of("TEACHER"));

    @BeforeEach
    void setUp() {
        repository = mock(ChatRepository.class);
        realtime = mock(ChatRealtimeHub.class);
        service = new ChatService(repository, realtime, new WorkspaceCrypto(), Clock.systemUTC(), mock(AuthService.class), mock(ExamAttemptRepository.class), mock(ProfileExamMutex.class));
    }

    @Test
    void deniesGroupConversationAfterMembershipWasRemoved() {
        when(repository.requireConversation(12L, 90)).thenReturn(Map.of("id", 90L, "organization_id", 12L, "group_id", 45L));
        when(repository.isActiveMember(12, 31)).thenReturn(true);
        when(repository.isGroupParticipant(12, 45, 31)).thenReturn(false);

        assertEquals(403, assertThrows(WorkspaceError.class, () -> service.messages(teacher, 90, null))
                .getStatusCode().value());
        verify(repository, never()).findMessages(anyLong(), anyLong(), any(), anyInt());
    }

    @Test
    void rejectsUnsupportedAttachmentContentBeforePersistence() {
        authorizeGroupConversation();
        var request = new ChatService.MessageRequest("", new ChatService.AttachmentRequest("notes.pdf", "aGVsbG8="));

        assertEquals(400, assertThrows(WorkspaceError.class, () -> service.send(teacher, 90, request))
                .getStatusCode().value());
        verify(repository, never()).insertMessage(anyLong(), anyLong(), anyLong(), anyString(),
                any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void requiresTextOrAttachment() {
        authorizeGroupConversation();

        assertEquals(400, assertThrows(WorkspaceError.class,
                () -> service.send(teacher, 90, new ChatService.MessageRequest("  ", null)))
                .getStatusCode().value());
        verify(repository, never()).insertMessage(anyLong(), anyLong(), anyLong(), anyString(),
                any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void storesOnlyValidatedAttachmentWithSanitizedNameAndNotifiesAfterSave() {
        authorizeGroupConversation();
        when(repository.insertMessage(anyLong(), anyLong(), anyLong(), anyString(), any(), any(), any(), any(), any(), any(), any()))
                .thenReturn(701L);
        when(repository.requireMessage(12, 90, 701)).thenReturn(messageRow(701, 31, "Report.pdf",
                "application/pdf", 8));

        ChatService.MessageView sent = service.send(teacher, 90,
                new ChatService.MessageRequest("Ето файла", new ChatService.AttachmentRequest("../Report.pdf", "JVBERi0xLjQ=")));

        assertEquals(701, sent.id());
        assertEquals("Report.pdf", sent.attachmentName());
        assertEquals("application/pdf", sent.attachmentType());
        verify(repository).insertMessage(eq(12L), eq(90L), eq(31L), eq("Ето файла"), eq("Report.pdf"),
                eq("application/pdf"), eq(8), any(byte[].class), any(), isNull(), anyString());
        verify(realtime).publish(12, 90, 701);
    }

    @Test
    void customGroupAllowsFiftyTotalMembersWithoutCreatingWorkspaceMemberships() {
        var actor = new OrgAccess.Scope(12, 31, Set.of("TEACHER"), true);
        var recipients = LongStream.rangeClosed(100, 148).boxed().toList();
        when(repository.isRegisteredUser(anyLong())).thenReturn(true);
        when(repository.insertRegisteredConversation(eq(12L), eq("custom_group"), isNull(), anyString())).thenReturn(90L);

        var group = service.createCustomGroup(actor, new ChatService.CustomGroupRequest("x".repeat(190), recipients));

        assertEquals(90, group.id());
        assertEquals("group", group.type());
        assertNull(group.groupId());
        verify(repository).lockRegisteredUsers(argThat(ids -> ids.size() == 50 && ids.contains(31L) && ids.containsAll(recipients)));
        verify(repository, times(50)).addConversationMember(eq(12L), eq(90L), anyLong());
        verify(realtime).publish(12, 90, 0);
    }

    @Test
    void administratorWithoutCustomGroupMembershipCannotReadItsHistory() {
        var actor = new OrgAccess.Scope(12, 31, Set.of("ADMIN"), true);
        when(repository.isRegisteredUser(31)).thenReturn(true);
        when(repository.requireConversation(null, 90)).thenReturn(Map.of("id", 90L, "organization_id", 12L, "chat_kind", "custom_group"));

        assertEquals(403, assertThrows(WorkspaceError.class, () -> service.messages(actor, 90, null)).getStatusCode().value());
        verify(repository, never()).findMessages(anyLong(), anyLong(), any(), anyInt());
    }

    private void authorizeGroupConversation() {
        when(repository.requireConversation(12L, 90)).thenReturn(Map.of("id", 90L, "organization_id", 12L, "group_id", 45L));
        when(repository.isActiveMember(12, 31)).thenReturn(true);
        when(repository.isGroupParticipant(12, 45, 31)).thenReturn(true);
    }

    private static Map<String, Object> messageRow(long id, long sender, String fileName, String contentType, int size) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", id);
        row.put("sender_id", sender);
        row.put("sender_name", "Учител");
        row.put("body", "Ето файла");
        row.put("attachment_name", fileName);
        row.put("attachment_type", contentType);
        row.put("attachment_size", size);
        row.put("created_at", "2026-11-06T09:00:00Z");
        return row;
    }
}
