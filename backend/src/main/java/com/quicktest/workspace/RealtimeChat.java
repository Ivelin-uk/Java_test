package com.quicktest.workspace;

import com.quicktest.access.EndpointCatalog;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.socket.*;
import org.springframework.web.socket.config.annotation.*;
import org.springframework.web.socket.handler.*;
import java.time.Clock;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import static com.quicktest.workspace.WorkspaceStore.*;

@Component
public class RealtimeChat extends TextWebSocketHandler {
    private final WorkspaceStore db;private final WorkspaceCrypto crypto;private final ChatService chat;private final Clock clock;
    private final TransactionTemplate transactions;private final TenantPermissions permissions;private final EndpointCatalog catalog;
    private final Map<String,Connection> connections=new ConcurrentHashMap<>();private final boolean workers;
    public RealtimeChat(WorkspaceStore db,WorkspaceCrypto crypto,ChatService chat,Clock clock,TransactionTemplate transactions,TenantPermissions permissions,EndpointCatalog catalog,@Value("${app.workspace.workers:true}") boolean workers) {this.db=db;this.crypto=crypto;this.chat=chat;this.clock=clock;this.transactions=transactions;this.permissions=permissions;this.catalog=catalog;this.workers=workers;}
    public Map<String,Object> ticket(OrgAccess.Scope scope,long conversation,String authorization) {
        return transactions.execute(tx->{chat.examGuard(scope);chat.conversation(scope,conversation);String raw=crypto.token();
            db.update("INSERT INTO realtime_tickets(token_hash,organization_id,conversation_id,user_id,auth_session_hash,expires_at) VALUES(?,?,?,?,?,?)",crypto.hash(raw),scope.organizationId(),conversation,scope.userId(),crypto.hash(authorization),clock.instant().plusSeconds(30));return Map.of("ticket",raw,"path","/ws/chat");});
    }
    @Override public void afterConnectionEstablished(WebSocketSession session) {session.setTextMessageSizeLimit(1024);connections.put(session.getId(),new Connection(new ConcurrentWebSocketSessionDecorator(session,2000,65536),clock.instant().plusSeconds(30)));}
    @Override protected void handleTextMessage(WebSocketSession session,TextMessage message) throws Exception {
        Connection connection=connections.get(session.getId());
        try {
            if(connection==null || connection.ticket!=null || message.getPayload().length()>500) throw WorkspaceError.forbidden();
            var request=db.object(message.getPayload());String raw=Objects.toString(request.get("ticket"),"");
            transactions.executeWithoutResult(tx->{var ticket=db.one("SELECT * FROM realtime_tickets WHERE token_hash=? FOR UPDATE",crypto.hash(raw));
                if(ticket.get("consumed_at")!=null || !clock.instant().isBefore(time(ticket,"expires_at"))) throw WorkspaceError.forbidden();
                connection.ticket=ticket;scope(connection);db.update("UPDATE realtime_tickets SET consumed_at=? WHERE token_hash=?",clock.instant(),crypto.hash(raw));
                connection.after=db.count("SELECT COALESCE(MAX(id),0) FROM workspace_messages WHERE organization_id=? AND conversation_id=?",number(ticket,"organization_id"),number(ticket,"conversation_id"));
            });session.sendMessage(new TextMessage("{\"ready\":true}"));
        } catch(Exception denied) {close(connection);}
    }
    private OrgAccess.Scope scope(Connection connection) {
        var ticket=connection.ticket;long org=number(ticket,"organization_id"),user=number(ticket,"user_id");
        var membership=db.one("SELECT m.roles_json FROM memberships m JOIN organizations o ON o.id=m.organization_id JOIN users u ON u.id=m.user_id WHERE m.organization_id=? AND m.user_id=? AND m.status='active' AND o.status='active' AND u.active=TRUE",org,user);
        boolean session=db.rows("SELECT token FROM auth_token WHERE user_id=? AND created_at>?",user,java.time.Instant.now().minusSeconds(86400)).stream().anyMatch(row->crypto.matches("Bearer "+string(row,"token"),string(ticket,"auth_session_hash")));
        if(!session) throw WorkspaceError.forbidden();
        var scope=new OrgAccess.Scope(org,user,Set.copyOf(Arrays.asList(db.parse(membership.get("roles_json"),String[].class))));
        if(!scope.roles().contains("ORG_ADMIN") && scope.roles().stream().noneMatch(r->permissions.allowed(scope,catalog.get("ChatController.messages"),r))) throw WorkspaceError.forbidden();
        chat.examGuard(scope);chat.conversation(scope,number(ticket,"conversation_id"));return scope;
    }
    @Scheduled(fixedDelay=1000) public void deliver() {
        if(!workers) return;
        for(Connection connection:connections.values()) {
            try {
                if(!connection.session.isOpen()) {close(connection);continue;}
                if(connection.ticket==null) {if(!clock.instant().isBefore(connection.authenticateBy)) close(connection);continue;}
                // Keep the profile mutex until send completes: exam start cannot race delivery.
                transactions.executeWithoutResult(tx->{var scope=scope(connection);var messages=chat.messages(scope,number(connection.ticket,"conversation_id"),connection.after);
                    if(!messages.isEmpty()) {try {connection.session.sendMessage(new TextMessage(db.json(Map.of("messages",messages))));} catch(java.io.IOException e) {throw new IllegalStateException(e);}connection.after=number(messages.getLast(),"id");}
                });
            } catch(Exception denied) {close(connection);}
        }
    }
    private void close(Connection connection) {if(connection==null) return;connections.remove(connection.session.getId());try {connection.session.close(CloseStatus.POLICY_VIOLATION);}catch(java.io.IOException ignored){}}
    @Override public void afterConnectionClosed(WebSocketSession session,CloseStatus status) {connections.remove(session.getId());}
    private static class Connection {final WebSocketSession session;final java.time.Instant authenticateBy;Map<String,Object> ticket;long after;Connection(WebSocketSession session,java.time.Instant authenticateBy) {this.session=session;this.authenticateBy=authenticateBy;}}
    @Configuration @EnableWebSocket static class SocketConfiguration implements WebSocketConfigurer {
        private final RealtimeChat handler;private final String origin;
        SocketConfiguration(RealtimeChat handler,@Value("${app.frontend-url}") String origin) {this.handler=handler;this.origin=origin;}
        @Override public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {registry.addHandler(handler,"/ws/chat").setAllowedOrigins(origin,"http://127.0.0.1:5173");}
    }
}
