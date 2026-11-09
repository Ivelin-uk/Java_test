package com.quicktest.workspace.repository;

import com.quicktest.workspace.WorkspaceStore;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Repository
public class ChatRepository {
    private final WorkspaceStore store;

    public ChatRepository(WorkspaceStore store) {
        this.store = store;
    }

    public List<Map<String, Object>> findGroups(Long organizationId, long userId) {
        return store.rows("""
                SELECT DISTINCT g.id,g.name,g.subject
                FROM learning_groups g JOIN organizations o ON o.id=g.organization_id AND o.status='active'
                WHERE (? IS NULL OR g.organization_id=?) AND g.deleted_at IS NULL
                  AND (
                    EXISTS (SELECT 1 FROM group_teachers t JOIN users actor ON actor.id=t.user_id AND actor.active=TRUE AND actor.role='TEACHER' JOIN memberships m
                      ON m.organization_id=t.organization_id AND m.user_id=t.user_id
                      WHERE t.organization_id=g.organization_id AND t.group_id=g.id
                        AND t.user_id=? AND m.status='active')
                    OR EXISTS (SELECT 1 FROM group_members gm JOIN users actor ON actor.id=gm.user_id AND actor.active=TRUE AND actor.role='STUDENT' JOIN memberships m
                      ON m.organization_id=gm.organization_id AND m.user_id=gm.user_id
                      WHERE gm.organization_id=g.organization_id AND gm.group_id=g.id
                        AND gm.user_id=? AND gm.active=TRUE AND m.status='active')
                  )
                ORDER BY g.name
                """, organizationId, organizationId, userId, userId);
    }

    public List<Map<String, Object>> findPeers(Long organizationId, long userId) {
        return store.rows("""
                SELECT DISTINCT u.id user_id,u.name
                FROM users u
                JOIN group_members gm ON gm.user_id=u.id AND (? IS NULL OR gm.organization_id=?)
                JOIN group_teachers gt ON gt.organization_id=gm.organization_id AND gt.group_id=gm.group_id
                JOIN memberships member ON member.organization_id=gm.organization_id AND member.user_id=gm.user_id
                JOIN memberships teacher ON teacher.organization_id=gt.organization_id AND teacher.user_id=gt.user_id
                JOIN learning_groups g ON g.organization_id=gm.organization_id AND g.id=gm.group_id
                JOIN organizations o ON o.id=g.organization_id AND o.status='active'
                WHERE gt.user_id=? AND gm.active=TRUE AND member.status='active'
                  AND teacher.status='active' AND g.deleted_at IS NULL AND u.active=TRUE AND u.role='STUDENT'
                  AND EXISTS (SELECT 1 FROM users actor WHERE actor.id=gt.user_id AND actor.role='TEACHER' AND actor.active=TRUE) AND u.id<>?
                UNION
                SELECT DISTINCT u.id user_id,u.name
                FROM users u
                JOIN group_teachers gt ON gt.user_id=u.id AND (? IS NULL OR gt.organization_id=?)
                JOIN group_members gm ON gm.organization_id=gt.organization_id AND gm.group_id=gt.group_id
                JOIN memberships member ON member.organization_id=gm.organization_id AND member.user_id=gm.user_id
                JOIN memberships teacher ON teacher.organization_id=gt.organization_id AND teacher.user_id=gt.user_id
                JOIN learning_groups g ON g.organization_id=gt.organization_id AND g.id=gt.group_id
                JOIN organizations o ON o.id=g.organization_id AND o.status='active'
                WHERE gm.user_id=? AND gm.active=TRUE AND member.status='active'
                  AND teacher.status='active' AND g.deleted_at IS NULL AND u.active=TRUE AND u.role='TEACHER'
                  AND EXISTS (SELECT 1 FROM users actor WHERE actor.id=gm.user_id AND actor.role='STUDENT' AND actor.active=TRUE) AND u.id<>?
                ORDER BY name
                """, organizationId, organizationId, userId, userId, organizationId, organizationId, userId, userId);
    }

    public List<Map<String, Object>> findRegisteredPeers(long userId, String query) {
        return store.rows("""
                SELECT id user_id,name,email,role FROM users
                WHERE id<>? AND active=TRUE AND role_selection_required=FALSE
                  AND role IN ('ADMIN','TEACHER','STUDENT')
                  AND (LOCATE(LOWER(?),LOWER(name))>0 OR LOCATE(LOWER(?),LOWER(email))>0)
                ORDER BY name,id
                """, userId, query, query);
    }

    public Optional<Map<String, Object>> findRegisteredUser(long userId) {
        return store.optional("""
                SELECT id user_id,name,email,role FROM users
                WHERE id=? AND active=TRUE AND role_selection_required=FALSE AND role IN ('ADMIN','TEACHER','STUDENT')
                """, userId);
    }

    public boolean isRegisteredUser(long userId) { return findRegisteredUser(userId).isPresent(); }

    public void lockRegisteredUsers(List<Long> userIds) {
        // All creators take account locks in the same order, including simultaneous reversed direct opens.
        userIds.stream().distinct().sorted().forEach(id -> store.optional("SELECT id FROM users WHERE id=? FOR UPDATE", id));
    }

    public Optional<Map<String, Object>> findRegisteredDirectConversation(String key) {
        return store.optional("SELECT id,organization_id FROM workspace_conversations WHERE registered_direct_key=?", key);
    }

    public Optional<Map<String, Object>> findLegacyDirectConversation(String key, long firstUser, long secondUser) {
        return store.optional("""
                SELECT c.id,c.organization_id FROM workspace_conversations c
                JOIN organizations o ON o.id=c.organization_id AND o.status='active'
                WHERE c.direct_key=? AND c.chat_kind='legacy' AND c.group_id IS NULL
                  AND EXISTS (SELECT 1 FROM conversation_members m WHERE m.organization_id=c.organization_id AND m.conversation_id=c.id AND m.user_id=?)
                  AND EXISTS (SELECT 1 FROM conversation_members m WHERE m.organization_id=c.organization_id AND m.conversation_id=c.id AND m.user_id=?)
                  AND (SELECT COUNT(*) FROM conversation_members m WHERE m.organization_id=c.organization_id AND m.conversation_id=c.id)=2
                ORDER BY c.id LIMIT 1
                """, key, firstUser, secondUser);
    }

    public long insertRegisteredConversation(long organizationId, String kind, String key, String title) {
        return store.insert("INSERT INTO workspace_conversations(organization_id,title,chat_kind,registered_direct_key) VALUES(?,?,?,?)",
                organizationId, title, kind, key);
    }

    public int promoteRegisteredDirect(long organizationId, long conversationId, String key) {
        return store.update("UPDATE workspace_conversations SET chat_kind='registered_direct',registered_direct_key=? WHERE organization_id=? AND id=?",
                key, organizationId, conversationId);
    }

    public boolean isActiveOrganization(long organizationId) {
        return store.count("SELECT COUNT(*) FROM organizations WHERE id=? AND status='active'", organizationId) == 1;
    }

    public void lockDirectPair(long organizationId, long firstUser, long secondUser) {
        store.rows("SELECT user_id FROM memberships WHERE organization_id=? AND user_id IN (?,?) ORDER BY user_id FOR UPDATE",
                organizationId, firstUser, secondUser);
    }

    public boolean hasTeacherStudentConnection(long organizationId, long teacherId, long studentId) {
        return store.count("""
                SELECT COUNT(*)
                FROM group_teachers t
                JOIN group_members s ON s.organization_id=t.organization_id AND s.group_id=t.group_id
                JOIN memberships tm ON tm.organization_id=t.organization_id AND tm.user_id=t.user_id AND tm.status='active'
                JOIN memberships sm ON sm.organization_id=s.organization_id AND sm.user_id=s.user_id AND sm.status='active'
                JOIN learning_groups g ON g.organization_id=t.organization_id AND g.id=t.group_id
                WHERE t.organization_id=? AND t.user_id=? AND s.user_id=? AND s.active=TRUE AND g.deleted_at IS NULL
                """, organizationId, teacherId, studentId) > 0;
    }

    public Map<String, Object> lockGroup(long organizationId, long groupId) {
        return store.one("SELECT id,name FROM learning_groups WHERE organization_id=? AND id=? AND deleted_at IS NULL FOR UPDATE",
                organizationId, groupId);
    }

    public Optional<Map<String, Object>> findGroupConversation(long organizationId, long groupId) {
        return store.optional("SELECT id FROM workspace_conversations WHERE organization_id=? AND group_id=? ORDER BY id LIMIT 1",
                organizationId, groupId);
    }

    public long insertGroupConversation(long organizationId, long groupId, String title) {
        return store.insert("INSERT INTO workspace_conversations(organization_id,group_id,title) VALUES(?,?,?)",
                organizationId, groupId, title);
    }

    public long insertDirectConversation(long organizationId, String directKey, String title) {
        return store.insert("INSERT INTO workspace_conversations(organization_id,title,direct_key) VALUES(?,?,?)",
                organizationId, title, directKey);
    }

    public Optional<Map<String, Object>> findDirectConversation(long organizationId, String directKey) {
        return store.optional("SELECT id FROM workspace_conversations WHERE organization_id=? AND direct_key=?",
                organizationId, directKey);
    }

    public int addConversationMember(long organizationId, long conversationId, long userId) {
        return store.update("INSERT IGNORE INTO conversation_members(organization_id,conversation_id,user_id) VALUES(?,?,?)",
                organizationId, conversationId, userId);
    }

    public int addCurrentGroupParticipants(long organizationId, long groupId, long conversationId) {
        int students = store.update("""
                INSERT IGNORE INTO conversation_members(organization_id,conversation_id,user_id)
                SELECT gm.organization_id,?,gm.user_id FROM group_members gm
                JOIN memberships m ON m.organization_id=gm.organization_id AND m.user_id=gm.user_id AND m.status='active'
                WHERE gm.organization_id=? AND gm.group_id=? AND gm.active=TRUE
                """, conversationId, organizationId, groupId);
        int teachers = store.update("""
                INSERT IGNORE INTO conversation_members(organization_id,conversation_id,user_id)
                SELECT gt.organization_id,?,gt.user_id FROM group_teachers gt
                JOIN memberships m ON m.organization_id=gt.organization_id AND m.user_id=gt.user_id AND m.status='active'
                WHERE gt.organization_id=? AND gt.group_id=?
                """, conversationId, organizationId, groupId);
        return students + teachers;
    }

    public List<Map<String, Object>> findThreads(Long organizationId, long userId) {
        return store.rows("""
                SELECT c.id,c.organization_id,c.group_id,c.title,c.chat_kind,g.name group_name,
                       peer.user_id peer_id,peer_user.name peer_name,
                       latest.id last_message_id,latest.body last_message,latest.attachment_name,
                       latest.created_at last_message_at,COALESCE(cm.read_through,0) read_through,
                       (SELECT COUNT(*) FROM workspace_messages unread
                        WHERE unread.organization_id=c.organization_id AND unread.conversation_id=c.id
                          AND unread.id>COALESCE(cm.read_through,0) AND unread.sender_id<>? AND unread.hidden=FALSE) unread_count
                FROM workspace_conversations c
                LEFT JOIN conversation_members cm ON cm.organization_id=c.organization_id
                  AND cm.conversation_id=c.id AND cm.user_id=?
                LEFT JOIN learning_groups g ON g.organization_id=c.organization_id AND g.id=c.group_id
                LEFT JOIN conversation_members peer ON peer.organization_id=c.organization_id
                  AND peer.conversation_id=c.id AND peer.user_id<>? AND c.group_id IS NULL AND c.chat_kind<>'custom_group'
                LEFT JOIN users peer_user ON peer_user.id=peer.user_id
                LEFT JOIN workspace_messages latest ON latest.organization_id=c.organization_id
                  AND latest.conversation_id=c.id AND latest.id=(
                    SELECT MAX(newest.id) FROM workspace_messages newest
                    WHERE newest.organization_id=c.organization_id AND newest.conversation_id=c.id AND newest.hidden=FALSE
                  )
                WHERE (? IS NULL OR c.organization_id=?) AND (
                  cm.user_id IS NOT NULL OR (g.deleted_at IS NULL AND (
                    EXISTS (SELECT 1 FROM group_teachers t JOIN users actor ON actor.id=t.user_id AND actor.active=TRUE AND actor.role='TEACHER' JOIN memberships m
                      ON m.organization_id=t.organization_id AND m.user_id=t.user_id AND m.status='active'
                      WHERE t.organization_id=c.organization_id AND t.group_id=c.group_id AND t.user_id=?)
                    OR EXISTS (SELECT 1 FROM group_members gm JOIN users actor ON actor.id=gm.user_id AND actor.active=TRUE AND actor.role='STUDENT' JOIN memberships m
                      ON m.organization_id=gm.organization_id AND m.user_id=gm.user_id AND m.status='active'
                      WHERE gm.organization_id=c.organization_id AND gm.group_id=c.group_id AND gm.user_id=? AND gm.active=TRUE)
                  )))
                ORDER BY COALESCE(latest.id,0) DESC,c.id DESC
                """, userId, userId, userId, organizationId, organizationId, userId, userId);
    }

    public Map<String, Object> requireGroup(Long organizationId, long groupId) {
        return store.one("SELECT id,organization_id,name FROM learning_groups WHERE (? IS NULL OR organization_id=?) AND id=? AND deleted_at IS NULL",
                organizationId, organizationId, groupId);
    }

    public Optional<Map<String, Object>> findPeerConnection(Long organizationId, long userId, long peerId) {
        return store.optional("""
                SELECT t.organization_id,t.group_id FROM group_teachers t
                JOIN group_members s ON s.organization_id=t.organization_id AND s.group_id=t.group_id AND s.active=TRUE
                JOIN learning_groups g ON g.organization_id=t.organization_id AND g.id=t.group_id AND g.deleted_at IS NULL
                JOIN organizations o ON o.id=t.organization_id AND o.status='active'
                JOIN memberships tm ON tm.organization_id=t.organization_id AND tm.user_id=t.user_id AND tm.status='active'
                JOIN memberships sm ON sm.organization_id=s.organization_id AND sm.user_id=s.user_id AND sm.status='active'
                JOIN users tu ON tu.id=t.user_id AND tu.active=TRUE AND tu.role='TEACHER'
                JOIN users su ON su.id=s.user_id AND su.active=TRUE AND su.role='STUDENT'
                WHERE (? IS NULL OR t.organization_id=?) AND ((t.user_id=? AND s.user_id=?) OR (t.user_id=? AND s.user_id=?))
                ORDER BY t.organization_id,t.group_id LIMIT 1
                """, organizationId, organizationId, userId, peerId, peerId, userId);
    }

    public Map<String, Object> lockConversation(long organizationId, long conversationId) {
        return store.one("SELECT id,organization_id,group_id,title,direct_key,chat_kind FROM workspace_conversations WHERE organization_id=? AND id=? FOR UPDATE",
                organizationId, conversationId);
    }

    public boolean isActiveMember(long organizationId, long userId) {
        return store.count("SELECT COUNT(*) FROM memberships m JOIN organizations o ON o.id=m.organization_id AND o.status='active' JOIN users u ON u.id=m.user_id AND u.active=TRUE WHERE m.organization_id=? AND m.user_id=? AND m.status='active'",
                organizationId, userId) == 1;
    }

    public Map<String, Object> requireConversation(Long organizationId, long conversationId) {
        return store.one("SELECT id,organization_id,group_id,title,direct_key,chat_kind FROM workspace_conversations WHERE (? IS NULL OR organization_id=?) AND id=?",
                organizationId, organizationId, conversationId);
    }

    public boolean isGroupParticipant(long organizationId, long groupId, long userId) {
        return store.count("""
                SELECT COUNT(*) FROM learning_groups g
                WHERE g.organization_id=? AND g.id=? AND g.deleted_at IS NULL AND (
                  EXISTS (SELECT 1 FROM group_teachers t JOIN users actor ON actor.id=t.user_id AND actor.active=TRUE AND actor.role='TEACHER' JOIN memberships m
                    ON m.organization_id=t.organization_id AND m.user_id=t.user_id
                    WHERE t.organization_id=g.organization_id AND t.group_id=g.id
                      AND t.user_id=? AND m.status='active')
                  OR EXISTS (SELECT 1 FROM group_members gm JOIN users actor ON actor.id=gm.user_id AND actor.active=TRUE AND actor.role='STUDENT' JOIN memberships m
                    ON m.organization_id=gm.organization_id AND m.user_id=gm.user_id
                    WHERE gm.organization_id=g.organization_id AND gm.group_id=g.id
                      AND gm.user_id=? AND gm.active=TRUE AND m.status='active')
                )
                """, organizationId, groupId, userId, userId) > 0;
    }

    public boolean isConversationMember(long organizationId, long conversationId, long userId) {
        return store.count("SELECT COUNT(*) FROM conversation_members WHERE organization_id=? AND conversation_id=? AND user_id=?",
                organizationId, conversationId, userId) > 0;
    }

    public Optional<Map<String, Object>> findDirectPeer(long organizationId, long conversationId, long userId) {
        return store.optional("""
                SELECT user_id FROM conversation_members
                WHERE organization_id=? AND conversation_id=? AND user_id<>?
                ORDER BY user_id LIMIT 1
                """, organizationId, conversationId, userId);
    }

    public long countConversationMembers(long organizationId, long conversationId) {
        return store.count("SELECT COUNT(*) FROM conversation_members WHERE organization_id=? AND conversation_id=?",
                organizationId, conversationId);
    }

    public List<Map<String, Object>> findMessages(long organizationId, long conversationId, Long beforeId, int limit) {
        String query = """
                SELECT m.id,m.sender_id,u.name sender_name,m.body,m.attachment_name,m.attachment_type,
                       m.attachment_size,m.created_at,m.client_message_id
                FROM workspace_messages m JOIN users u ON u.id=m.sender_id
                WHERE m.organization_id=? AND m.conversation_id=? AND m.hidden=FALSE
                """ + (beforeId == null ? "" : " AND m.id<?") + " ORDER BY m.id DESC LIMIT ?";
        return beforeId == null
                ? store.rows(query, organizationId, conversationId, limit)
                : store.rows(query, organizationId, conversationId, beforeId, limit);
    }

    public Map<String, Object> requireMessage(long organizationId, long conversationId, long messageId) {
        return store.one("""
                SELECT m.id,m.sender_id,u.name sender_name,m.body,m.attachment_name,m.attachment_type,
                       m.attachment_size,m.created_at,m.client_message_id
                FROM workspace_messages m JOIN users u ON u.id=m.sender_id
                WHERE m.organization_id=? AND m.conversation_id=? AND m.id=? AND m.hidden=FALSE
                """, organizationId, conversationId, messageId);
    }

    public long insertMessage(long organizationId, long conversationId, long senderId, String text,
                              String fileName, String fileType, Integer fileSize, byte[] fileContent, Instant timestamp,
                              String clientMessageId, String requestHash) {
        return store.insert("""
                INSERT INTO workspace_messages(organization_id,conversation_id,sender_id,body,attachment_name,
                  attachment_type,attachment_size,attachment_content,created_at,client_message_id,request_hash)
                VALUES(?,?,?,?,?,?,?,?,?,?,?)
                """, organizationId, conversationId, senderId, text, fileName, fileType, fileSize, fileContent, timestamp,
                clientMessageId, requestHash);
    }

    public Optional<Map<String, Object>> findMessageByClientId(long organizationId, long conversationId, long senderId, String clientMessageId) {
        return store.optional("SELECT id,request_hash FROM workspace_messages WHERE organization_id=? AND conversation_id=? AND sender_id=? AND client_message_id=?",
                organizationId, conversationId, senderId, clientMessageId);
    }

    public List<Map<String, Object>> findMessagesAfter(long organizationId, long conversationId, long afterId, int limit) {
        return store.rows("""
                SELECT m.id,m.sender_id,u.name sender_name,m.body,m.attachment_name,m.attachment_type,
                       m.attachment_size,m.created_at,m.client_message_id
                FROM workspace_messages m JOIN users u ON u.id=m.sender_id
                WHERE m.organization_id=? AND m.conversation_id=? AND m.hidden=FALSE AND m.id>?
                ORDER BY m.id ASC LIMIT ?
                """, organizationId, conversationId, afterId, limit);
    }

    public int markRead(long organizationId, long conversationId, long userId, long messageId) {
        return store.update("""
                UPDATE conversation_members SET read_through=GREATEST(read_through,?)
                WHERE organization_id=? AND conversation_id=? AND user_id=? AND read_through<?
                """, messageId, organizationId, conversationId, userId, messageId);
    }

    public long lastMessageId(long organizationId, long conversationId) {
        return store.count("SELECT COALESCE(MAX(id),0) FROM workspace_messages WHERE organization_id=? AND conversation_id=? AND hidden=FALSE",
                organizationId, conversationId);
    }

    public Attachment requireAttachment(long organizationId, long conversationId, long messageId) {
        var metadata = store.one("""
                SELECT attachment_name,attachment_type
                FROM workspace_messages WHERE organization_id=? AND conversation_id=? AND id=?
                  AND hidden=FALSE AND attachment_content IS NOT NULL
                """, organizationId, conversationId, messageId);
        byte[] content = store.bytes("""
                SELECT attachment_content
                FROM workspace_messages WHERE organization_id=? AND conversation_id=? AND id=?
                  AND hidden=FALSE AND attachment_content IS NOT NULL
                """, organizationId, conversationId, messageId);
        return new Attachment(String.valueOf(metadata.get("attachment_name")), String.valueOf(metadata.get("attachment_type")), content);
    }

    public int insertRealtimeTicket(String tokenHash, long organizationId, long conversationId, long userId,
                                    String authSessionHash, Instant expiresAt) {
        return store.update("""
                INSERT INTO realtime_tickets(token_hash,organization_id,conversation_id,user_id,auth_session_hash,expires_at)
                VALUES(?,?,?,?,?,?)
                """, tokenHash, organizationId, conversationId, userId, authSessionHash, expiresAt);
    }

    public boolean consumeRealtimeTicket(String tokenHash, long organizationId, long conversationId, long userId,
                                        String authSessionHash, Instant timestamp) {
        return store.update("""
                UPDATE realtime_tickets SET consumed_at=?
                WHERE token_hash=? AND organization_id=? AND conversation_id=? AND user_id=?
                  AND auth_session_hash=? AND consumed_at IS NULL AND expires_at>?
                """, timestamp, tokenHash, organizationId, conversationId, userId, authSessionHash, timestamp) == 1;
    }

    public int insertAccountRealtimeTicket(String tokenHash, long organizationId, long userId,
                                           String authSessionHash, Instant expiresAt) {
        return store.update("INSERT INTO chat_account_tickets(token_hash,organization_id,user_id,auth_session_hash,expires_at) VALUES(?,?,?,?,?)",
                tokenHash, organizationId, userId, authSessionHash, expiresAt);
    }

    public boolean consumeAccountRealtimeTicket(String tokenHash, long organizationId, long userId,
                                               String authSessionHash, Instant timestamp) {
        return store.update("""
                UPDATE chat_account_tickets SET consumed_at=?
                WHERE token_hash=? AND organization_id=? AND user_id=? AND auth_session_hash=?
                  AND consumed_at IS NULL AND expires_at>?
                """, timestamp, tokenHash, organizationId, userId, authSessionHash, timestamp) == 1;
    }

    public void deleteExpiredTickets(Instant timestamp) {
        store.update("DELETE FROM chat_account_tickets WHERE expires_at<?", timestamp);
        store.update("DELETE FROM realtime_tickets WHERE expires_at<?", timestamp);
    }

    public record Attachment(String name, String contentType, byte[] content) {}
}
