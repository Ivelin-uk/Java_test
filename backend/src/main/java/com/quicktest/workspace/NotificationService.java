package com.quicktest.workspace;

import com.quicktest.workspace.repository.NotificationRepository;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import java.time.Clock;
import java.util.*;
import static com.quicktest.workspace.WorkspaceValues.*;

@Service
public class NotificationService {
    private final WorkspaceJson json;
    private final NotificationRepository repository;
    private final Clock clock;
    private final TransactionTemplate transactions;
    private final boolean workers;
    private final String adapter;
    private final MailGateway gateway;
    private final String frontend;
    public NotificationService(NotificationRepository repository,WorkspaceJson json,Clock clock,TransactionTemplate transactions,MailGateway gateway,@Value("${app.workspace.workers:true}") boolean workers,@Value("${app.mail.adapter:local}") String adapter,@Value("${app.frontend-url}") String frontend) {
        this.repository=repository;this.json=json;this.clock=clock;this.transactions=transactions;this.gateway=gateway;this.workers=workers;this.adapter=adapter;this.frontend=frontend.replaceAll("/+$","");
    }
    public long enqueue(Long org,Long revision,Long user,String type,String email,Map<String,?> payload) {
        Map<String,Object> content=new LinkedHashMap<>(payload);content.put("notificationType",type);content.put("date",clock.instant().toString());
        return repository.insertNotification(org, revision, user, type, email, json.write(content), clock.instant(), clock.instant());
    }
    public String verifiedAddress(long user) {
        var address=repository.requireNotificationAddress(user);
        if(address.get("verified_at")==null) throw WorkspaceError.conflict("Потвърдете имейла за известия преди начало на изпит.");
        return string(address,"email");
    }
    public Optional<String> verifiedAddressIfPresent(long user) {
        return repository.findVerifiedAddress(user).map(address->string(address,"email"));
    }
    public void enqueueAssignment(Long organization,long student,String organizationName,String test,long assignment) {
        verifiedAddressIfPresent(student).ifPresent(email -> enqueue(organization,null,student,"assignment_assigned",email,Map.of(
                "organization",organizationName,"test",test,"assignmentPath","/learner/assignments/"+assignment)));
    }
    @Transactional
    public Map<String,Object> ensureResultDelivery(long org,long revision,long user,Map<String,Object> payload) {
        String email=verifiedAddress(user);
        var existing=repository.lockResultDelivery(org,revision,user);
        long id;String status;
        if(existing.isEmpty()) {id=enqueue(org,revision,user,"final_result",email,payload);status="queued";}
        else {
            var row=existing.get();id=number(row,"id");status=string(row,"status");
            if(status.equals("uncertain")) throw WorkspaceError.conflict("Статусът на предишното изпращане е неясен. Проверете доставката при имейл услугата преди повторение.");
            if(!email.equalsIgnoreCase(string(row,"recipient_email"))) throw WorkspaceError.conflict("Имейлът за известия е променен след публикуването. Предишното писмо не може да бъде повторено към друг адрес.");
            boolean localOnly=status.equals("sent") && !adapter.equals("local") && string(row,"provider_message_id").equals("local-"+id);
            if(status.equals("failed") || localOnly) {repository.requeueDelivery(clock.instant(),org,id);status="queued";}
        }
        return Map.of("id",id,"status",status,"adapter",adapter);
    }
    public List<Map<String,Object>> localInbox(long user) {
        if(!adapter.equals("local")) throw WorkspaceError.notFound();
        var address=repository.findVerifiedAddress(user);return repository.findInbox(user, address.map(row->string(row,"email")).orElse(""));
    }
    @Scheduled(fixedDelay=2000)
    public void deliver() {
        if(!workers) return;
        List<Map<String,Object>> pending=transactions.execute(tx-> {
            repository.markInterruptedDeliveries(clock.instant());
            var rows=repository.lockQueuedDeliveries(clock.instant());
            for(var row:rows) repository.markProcessing(clock.instant().plusSeconds(300), number(row,"id"));return rows;
        });
        for(var row:Objects.requireNonNull(pending)) {
            long id=number(row,"id");
            try {
                String receipt=gateway.send(id,string(row,"recipient_email"),json.object(row.get("payload_json")));
                repository.markSent(clock.instant(), receipt, id);
            } catch(org.springframework.mail.MailAuthenticationException | MailDeliveryRejected safeFailure) {
                long attempted=number(row,"attempts")+1;
                repository.markRetryableFailure(attempted<3?"queued":"failed", clock.instant().plusSeconds(10*attempted), id);
            } catch(Exception unknown) {
                repository.markUncertain(id);
            }
        }
    }
    @Transactional
    public void retry(OrgAccess.Scope scope,long id) {
        var row=repository.lockDeliveryStatus(scope.organizationId(), id);
        if(!string(row,"status").equals("failed")) throw WorkspaceError.conflict("Само доказано неуспешни доставки се повтарят.");
        repository.requeueDelivery(clock.instant(), scope.organizationId(), id);
    }
}
