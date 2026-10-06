package com.quicktest.workspace;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import java.time.Clock;
import java.util.*;
import static com.quicktest.workspace.WorkspaceStore.*;

@Service
public class NotificationService {
    private final WorkspaceStore db;
    private final Clock clock;
    private final TransactionTemplate transactions;
    private final boolean workers;
    private final String adapter;
    private final MailGateway gateway;
    public NotificationService(WorkspaceStore db,Clock clock,TransactionTemplate transactions,MailGateway gateway,@Value("${app.workspace.workers:true}") boolean workers,@Value("${app.mail.adapter:local}") String adapter) {
        this.db=db;this.clock=clock;this.transactions=transactions;this.gateway=gateway;this.workers=workers;this.adapter=adapter;
    }
    public long enqueue(Long org,Long revision,Long user,String type,String email,Map<String,?> payload) {
        Map<String,Object> content=new LinkedHashMap<>(payload);content.put("notificationType",type);content.put("date",clock.instant().toString());
        return db.insert("INSERT INTO notification_outbox(organization_id,revision_id,user_id,notification_type,recipient_email,payload_json,available_at,created_at) VALUES(?,?,?,?,?,?,?,?)",org,revision,user,type,email,db.json(content),clock.instant(),clock.instant());
    }
    public String verifiedAddress(long user) {
        var address=db.one("SELECT email,verified_at FROM notification_addresses WHERE user_id=?",user);
        if(address.get("verified_at")==null) throw WorkspaceError.conflict("Потвърдете имейла за известия преди начало на изпит.");
        return string(address,"email");
    }
    public List<Map<String,Object>> localInbox(long user) {
        if(!adapter.equals("local")) throw WorkspaceError.notFound();
        var address=db.optional("SELECT email FROM notification_addresses WHERE user_id=? AND verified_at IS NOT NULL",user);return db.rows("SELECT id,notification_type,recipient_email,payload_json,status,created_at,sent_at FROM notification_outbox WHERE user_id=? OR (user_id IS NULL AND recipient_email=?) ORDER BY id DESC LIMIT 100",user,address.map(row->string(row,"email")).orElse(""));
    }
    @Scheduled(fixedDelay=2000)
    public void deliver() {
        if(!workers) return;
        List<Map<String,Object>> pending=transactions.execute(tx-> {
            db.update("UPDATE notification_outbox SET status='uncertain',last_error='Interrupted delivery; reconcile before retry' WHERE status='processing' AND available_at<?",clock.instant());
            var rows=db.rows("SELECT * FROM notification_outbox WHERE status='queued' AND available_at<=? ORDER BY id LIMIT 20 FOR UPDATE",clock.instant());
            for(var row:rows) db.update("UPDATE notification_outbox SET status='processing',available_at=?,attempts=attempts+1 WHERE id=?",clock.instant().plusSeconds(300),number(row,"id"));return rows;
        });
        for(var row:Objects.requireNonNull(pending)) {
            long id=number(row,"id");
            try {
                String receipt=gateway.send(id,string(row,"recipient_email"),db.object(row.get("payload_json")));
                db.update("UPDATE notification_outbox SET status='sent',sent_at=?,provider_message_id=?,last_error=NULL WHERE id=? AND status='processing'",clock.instant(),receipt,id);
            } catch(org.springframework.mail.MailAuthenticationException safeFailure) {
                long attempted=number(row,"attempts")+1;
                db.update("UPDATE notification_outbox SET status=?,available_at=?,last_error='SMTP authentication or recipient allowlist failed' WHERE id=? AND status='processing'",attempted<3?"queued":"failed",clock.instant().plusSeconds(10*attempted),id);
            } catch(Exception unknown) {
                db.update("UPDATE notification_outbox SET status='uncertain',last_error='Delivery outcome unknown; automatic retry disabled' WHERE id=? AND status='processing'",id);
            }
        }
    }
    @Transactional
    public void retry(OrgAccess.Scope scope,long id) {
        var row=db.one("SELECT status FROM notification_outbox WHERE organization_id=? AND id=? FOR UPDATE",scope.organizationId(),id);
        if(!string(row,"status").equals("failed")) throw WorkspaceError.conflict("Само доказано неуспешни доставки се повтарят.");
        db.update("UPDATE notification_outbox SET status='queued',available_at=? WHERE organization_id=? AND id=?",clock.instant(),scope.organizationId(),id);
    }
}
