package com.quicktest.workspace;

import com.quicktest.access.EndpointPolicy;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/conversations")
@EndpointPolicy(mode=EndpointPolicy.Mode.TENANT,student=true)
@PreAuthorize("isAuthenticated()")
public class ChatController {
    private final OrgAccess access;private final ChatService service;private final RealtimeChat realtime;private final WorkspaceStore db;
    public ChatController(OrgAccess access,ChatService service,RealtimeChat realtime,WorkspaceStore db) {this.access=access;this.service=service;this.realtime=realtime;this.db=db;}
    @GetMapping public Object list() {return service.list(access.scope());}
    @PostMapping public Object create(@RequestBody ChatService.Conversation request) {return service.create(access.scope(),request);}
    @GetMapping("/{id}/messages") public Object messages(@PathVariable long id,@RequestParam(defaultValue="0") long after) {return service.messages(access.scope(),id,after);}
    @PostMapping("/{id}/messages") public void send(@PathVariable long id,@RequestBody Message request) {service.send(access.scope(),id,request.body());}
    @PostMapping("/{id}/ticket") public Object ticket(@PathVariable long id) {return realtime.ticket(access.scope(),id,access.authSession());}
    @PutMapping("/blocks/{user}") public void block(@PathVariable long user,@RequestBody Block request) {service.block(access.scope(),user,request.blocked());}
    @PostMapping("/messages/{id}/report") public void report(@PathVariable long id,@RequestBody Reason request) {service.report(access.scope(),id,request.reason());}
    @GetMapping("/reports") public Object reports() {return db.rows("SELECT r.*,m.body FROM message_reports r JOIN workspace_messages m ON m.organization_id=r.organization_id AND m.id=r.message_id WHERE r.organization_id=? ORDER BY r.id DESC LIMIT 100",access.admin().organizationId());}
    @PutMapping("/reports/{id}") public void moderate(@PathVariable long id,@RequestBody Moderation request) {service.moderate(access.admin(),id,request.resolution(),request.hide());}
    public record Message(String body) {}
    public record Block(boolean blocked) {}
    public record Reason(String reason) {}
    public record Moderation(String resolution,boolean hide) {}
}
