package com.quicktest.workspace.repository;

import com.quicktest.workspace.WorkspaceStore;
import org.springframework.stereotype.Repository;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.time.Instant;
import java.util.*;

@Repository
public class TeacherBillingRepository {
    private final WorkspaceStore store;
    public TeacherBillingRepository(WorkspaceStore store) {this.store=store;}
    public Map<String,Object> lockTeacher(long user) {return store.one("SELECT u.id,p.organization_id FROM users u JOIN personal_workspaces p ON p.user_id=u.id WHERE u.id=? AND u.role='TEACHER' AND u.active=true FOR UPDATE",user);}
    public Optional<Map<String,Object>> findByUserId(long user) {return store.optional("SELECT * FROM teacher_billing_accounts WHERE user_id=?",user);}
    public List<Map<String,Object>> findTeacherPlansForAdmin() {
        return store.rows("SELECT u.id user_id,a.provider_status,a.stripe_mode,a.billing_period,a.paid_through,a.cancel_at_period_end,o.plan manual_plan FROM users u LEFT JOIN teacher_billing_accounts a ON a.user_id=u.id LEFT JOIN teacher_plan_overrides o ON o.user_id=u.id WHERE u.role='TEACHER' ORDER BY u.id");
    }
    public Optional<String> planOverride(long user) {return store.optional("SELECT plan FROM teacher_plan_overrides WHERE user_id=?",user).map(row->row.get("plan").toString());}
    public void setPlanOverride(long user,String plan,long actor,Instant now) {
        if(plan.equals("auto")) store.update("DELETE FROM teacher_plan_overrides WHERE user_id=?",user);
        else store.update("INSERT INTO teacher_plan_overrides(user_id,plan,updated_by,updated_at) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE plan=VALUES(plan),updated_by=VALUES(updated_by),updated_at=VALUES(updated_at)",user,plan,actor,now);
    }
    public Optional<Map<String,Object>> adminRequest(long actor,String key) {return store.optional("SELECT user_id,action,requested_plan FROM teacher_admin_billing_requests WHERE actor_id=? AND request_key=? FOR UPDATE",actor,key);}
    public void recordAdminRequest(long actor,String key,long user,String action,String period,Instant now) {store.update("INSERT INTO teacher_admin_billing_requests(actor_id,request_key,user_id,action,requested_plan,created_at) VALUES(?,?,?,?,?,?)",actor,key,user,action,period,now);}
    public Optional<Map<String,Object>> findPayment(String invoice) {return store.optional("SELECT * FROM teacher_payment_history WHERE invoice_id=? FOR UPDATE",invoice);}
    public void savePayment(String invoice,long user,String eventId,String eventType,String status,String period,long amountDue,long amountPaid,String currency,Instant paymentAt,Instant periodStart,Instant periodEnd,Instant providerEventAt,Instant now) {
        store.update("INSERT INTO teacher_payment_history(invoice_id,user_id,event_id,event_type,payment_status,billing_period,amount_due,amount_paid,currency,payment_at,period_start,period_end,provider_event_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE event_id=VALUES(event_id),event_type=VALUES(event_type),payment_status=VALUES(payment_status),billing_period=VALUES(billing_period),amount_due=VALUES(amount_due),amount_paid=VALUES(amount_paid),currency=VALUES(currency),payment_at=VALUES(payment_at),period_start=VALUES(period_start),period_end=VALUES(period_end),provider_event_at=VALUES(provider_event_at),updated_at=VALUES(updated_at)",invoice,user,eventId,eventType,status,period,amountDue,amountPaid,currency,paymentAt,periodStart,periodEnd,providerEventAt,now,now);
    }
    public List<Map<String,Object>> payments(long user,YearMonth month) {
        if(month==null) return store.rows("SELECT * FROM teacher_payment_history WHERE user_id=? ORDER BY payment_at DESC,invoice_id DESC LIMIT 500",user);
        Instant from=month.atDay(1).atStartOfDay().toInstant(ZoneOffset.UTC),until=month.plusMonths(1).atDay(1).atStartOfDay().toInstant(ZoneOffset.UTC);
        return store.rows("SELECT * FROM teacher_payment_history WHERE user_id=? AND payment_at>=? AND payment_at<? ORDER BY payment_at DESC,invoice_id DESC LIMIT 500",user,from,until);
    }
    public List<Map<String,Object>> allPayments(YearMonth month) {
        if(month==null) return store.rows("SELECT * FROM teacher_payment_history ORDER BY payment_at DESC,invoice_id DESC LIMIT 1000");
        Instant from=month.atDay(1).atStartOfDay().toInstant(ZoneOffset.UTC),until=month.plusMonths(1).atDay(1).atStartOfDay().toInstant(ZoneOffset.UTC);
        return store.rows("SELECT * FROM teacher_payment_history WHERE payment_at>=? AND payment_at<? ORDER BY payment_at DESC,invoice_id DESC LIMIT 1000",from,until);
    }
    public void create(long user,long workspace,String mode,Instant now) {store.update("INSERT INTO teacher_billing_accounts(user_id,workspace_id,stripe_mode,updated_at) VALUES(?,?,?,?)",user,workspace,mode,now);}
    public Optional<Map<String,Object>> findCheckout(long user,String key) {return store.optional("SELECT * FROM teacher_checkout_requests WHERE user_id=? AND request_key=?",user,key);}
    public Optional<Map<String,Object>> pendingCheckout(long user) {return store.optional("SELECT * FROM teacher_checkout_requests WHERE user_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1",user);}
    public void createCheckout(long user,String key,String period,String price,Instant now) {store.update("INSERT INTO teacher_checkout_requests(user_id,request_key,billing_period,price_id,created_at) VALUES(?,?,?,?,?)",user,key,period,price,now);}
    public void saveCheckout(long user,String key,String session,String url) {store.update("UPDATE teacher_checkout_requests SET session_id=?,checkout_url=? WHERE user_id=? AND request_key=?",session,url,user,key);}
    public void finishCheckout(long user,String key,String status) {store.update("UPDATE teacher_checkout_requests SET status=? WHERE user_id=? AND request_key=?",status,user,key);}
    public boolean seenEvent(String id) {return store.count("SELECT COUNT(*) FROM teacher_billing_events WHERE event_id=?",id)>0;}
    public void recordEvent(String id,long user,String type,long created,Instant now) {store.update("INSERT INTO teacher_billing_events(event_id,user_id,event_type,provider_timestamp,created_at) VALUES(?,?,?,?,?)",id,user,type,created,now);}
    public void update(long user,String customer,String subscription,String status,String period,Instant through,boolean cancel,Instant now) {store.update("UPDATE teacher_billing_accounts SET stripe_customer_id=?,stripe_subscription_id=?,provider_status=?,billing_period=?,paid_through=?,cancel_at_period_end=?,updated_at=? WHERE user_id=?",customer,subscription,status,period,through,cancel,now,user);}
}
