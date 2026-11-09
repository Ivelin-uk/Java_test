package com.quicktest.workspace;

import com.quicktest.access.EndpointPolicy;
import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.nio.charset.StandardCharsets;

@RestController
@RequestMapping("/api/v1/chat")
@EndpointPolicy(mode = EndpointPolicy.Mode.TENANT, student = true)
@PreAuthorize("isAuthenticated()")
public class ChatController {
    private final OrgAccess access;
    private final ChatService chat;

    public ChatController(OrgAccess access, ChatService chat) {
        this.access = access;
        this.chat = chat;
    }

    @GetMapping("/groups")
    public Object groups() {
        return chat.groups(access.scope());
    }

    @GetMapping("/peers")
    public Object peers(@RequestParam(required = false) String query) {
        return chat.peers(access.scope(), query);
    }

    @GetMapping("/threads")
    public Object threads() {
        return chat.threads(access.scope());
    }

    @PostMapping("/groups/{groupId}")
    public Object openGroup(@PathVariable long groupId) {
        return chat.openGroup(access.scope(), groupId);
    }

    @PostMapping("/direct/{peerId}")
    public Object openDirect(@PathVariable long peerId) {
        return chat.openDirect(access.scope(), peerId);
    }

    @PostMapping("/custom-groups")
    public Object createCustomGroup(@Valid @RequestBody ChatService.CustomGroupRequest request) {
        return chat.createCustomGroup(access.scope(), request);
    }

    @GetMapping("/conversations/{conversationId}/messages")
    public Object messages(@PathVariable long conversationId, @RequestParam(required = false) Long beforeId,
                           @RequestParam(required = false) Long afterId) {
        return chat.messages(access.scope(), conversationId, beforeId, afterId);
    }

    @PostMapping("/conversations/{conversationId}/messages")
    public Object send(@PathVariable long conversationId, @Valid @RequestBody ChatService.MessageRequest request) {
        return chat.send(access.scope(), conversationId, request);
    }

    @PostMapping("/conversations/{conversationId}/read")
    public void markRead(@PathVariable long conversationId, @Valid @RequestBody(required = false) ChatService.ReadRequest request) {
        chat.markRead(access.scope(), conversationId, request);
    }

    @GetMapping("/conversations/{conversationId}/messages/{messageId}/attachment")
    public ResponseEntity<byte[]> attachment(@PathVariable long conversationId, @PathVariable long messageId) {
        var attachment = chat.attachment(access.scope(), conversationId, messageId);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(attachment.contentType()))
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename(attachment.name(), StandardCharsets.UTF_8).build().toString())
                .header("X-Content-Type-Options", "nosniff")
                .cacheControl(CacheControl.noStore())
                .body(attachment.content());
    }

    @PostMapping("/realtime-ticket")
    public Object accountRealtimeTicket() {
        return java.util.Map.of("ticket", chat.issueAccountRealtimeTicket(access.scope(), access.authSession()));
    }

    @GetMapping(path = "/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public ResponseEntity<SseEmitter> accountEvents(@RequestParam String ticket) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).header("X-Accel-Buffering", "no")
                .body(chat.accountEvents(access.scope(), access.authSession(), ticket));
    }

    @PostMapping("/conversations/{conversationId}/realtime-ticket")
    public Object realtimeTicket(@PathVariable long conversationId) {
        return java.util.Map.of("ticket", chat.issueRealtimeTicket(access.scope(), conversationId, access.authSession()));
    }

    @GetMapping(path = "/conversations/{conversationId}/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public ResponseEntity<SseEmitter> events(@PathVariable long conversationId, @RequestParam String ticket) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).header("X-Accel-Buffering", "no")
                .body(chat.conversationEvents(access.scope(), conversationId, access.authSession(), ticket));
    }
}
