package com.quicktest.workspace.repository;

import com.quicktest.workspace.WorkspaceStore;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.*;

@Repository
public class NotificationRepository {
    private final WorkspaceStore store;

    public NotificationRepository(WorkspaceStore store) {
        this.store = store;
    }

    public long insertNotification(Long org, Long revision, Long user, String type, String email, String jsonValue, Instant timestamp, Instant timestamp2) {
        return store.insert("INSERT INTO notification_outbox(organization_id,revision_id,user_id,notification_type,recipient_email,payload_json,available_at,created_at) VALUES(?,?,?,?,?,?,?,?)", org, revision, user, type, email, jsonValue, timestamp, timestamp2);
    }

    public Map<String, Object> requireNotificationAddress(long user) {
        return store.one("SELECT email,verified_at FROM notification_addresses WHERE user_id=?", user);
    }

    public Optional<Map<String,Object>> lockResultDelivery(long organizationId,long revision,long user) {
        return store.optional("SELECT id,status,recipient_email,provider_message_id FROM notification_outbox WHERE organization_id=? AND revision_id=? AND user_id=? AND notification_type='final_result' FOR UPDATE",organizationId,revision,user);
    }

    public Optional<Map<String, Object>> findVerifiedAddress(long user) {
        return store.optional("SELECT email FROM notification_addresses WHERE user_id=? AND verified_at IS NOT NULL", user);
    }

    public List<Map<String, Object>> findInbox(long user, String value) {
        return store.rows("SELECT id,notification_type,recipient_email,payload_json,status,created_at,sent_at FROM notification_outbox WHERE user_id=? OR (user_id IS NULL AND recipient_email=?) ORDER BY id DESC LIMIT 100", user, value);
    }

    public int markInterruptedDeliveries(Instant timestamp) {
        return store.update("UPDATE notification_outbox SET status='uncertain',last_error='Interrupted delivery; reconcile before retry' WHERE status='processing' AND available_at<?", timestamp);
    }

    public List<Map<String, Object>> lockQueuedDeliveries(Instant timestamp) {
        return store.rows("SELECT * FROM notification_outbox WHERE status='queued' AND available_at<=? ORDER BY id LIMIT 20 FOR UPDATE", timestamp);
    }

    public int markProcessing(Instant value, long id) {
        return store.update("UPDATE notification_outbox SET status='processing',available_at=?,attempts=attempts+1 WHERE id=?", value, id);
    }

    public int markSent(Instant timestamp, String receipt, long id) {
        return store.update("UPDATE notification_outbox SET status='sent',sent_at=?,provider_message_id=?,last_error=NULL WHERE id=? AND status='processing'", timestamp, receipt, id);
    }

    public int markRetryableFailure(Object value, Instant value2, long id) {
        return store.update("UPDATE notification_outbox SET status=?,available_at=?,last_error='Mail provider rejected the request or recipient domain' WHERE id=? AND status='processing'", value, value2, id);
    }

    public int markUncertain(long id) {
        return store.update("UPDATE notification_outbox SET status='uncertain',last_error='Delivery outcome unknown; automatic retry disabled' WHERE id=? AND status='processing'", id);
    }

    public Map<String, Object> lockDeliveryStatus(long organizationId, long id) {
        return store.one("SELECT status FROM notification_outbox WHERE organization_id=? AND id=? FOR UPDATE", organizationId, id);
    }

    public int requeueDelivery(Instant timestamp, long organizationId, long id) {
        return store.update("UPDATE notification_outbox SET status='queued',available_at=? WHERE organization_id=? AND id=?", timestamp, organizationId, id);
    }
}
