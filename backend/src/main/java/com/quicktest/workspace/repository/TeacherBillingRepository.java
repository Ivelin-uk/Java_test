package com.quicktest.workspace.repository;

import com.quicktest.workspace.WorkspaceStore;
import org.springframework.stereotype.Repository;
import java.time.Instant;
import java.util.*;

@Repository
public class TeacherBillingRepository {
    private final WorkspaceStore store;
    public TeacherBillingRepository(WorkspaceStore store) {this.store=store;}
    public Map<String,Object> lockTeacher(long user) {return store.one("SELECT u.id,p.organization_id FROM users u JOIN personal_workspaces p ON p.user_id=u.id WHERE u.id=? AND u.role='TEACHER' AND u.active=true FOR UPDATE",user);}
    public Optional<Map<String,Object>> findByUserId(long user) {return store.optional("SELECT * FROM teacher_billing_accounts WHERE user_id=?",user);}
    public void create(long user,long workspace,String mode,Instant now) {store.update("INSERT INTO teacher_billing_accounts(user_id,workspace_id,stripe_mode,updated_at) VALUES(?,?,?,?)",user,workspace,mode,now);}
    public Optional<Map<String,Object>> findCheckout(long user,String key) {return store.optional("SELECT * FROM teacher_checkout_requests WHERE user_id=? AND request_key=?",user,key);}
    public Optional<Map<String,Object>> pendingCheckout(long user) {return store.optional("SELECT * FROM teacher_checkout_requests WHERE user_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1",user);}
    public void createCheckout(long user,String key,String period,String price,Instant now) {store.update("INSERT INTO teacher_checkout_requests(user_id,request_key,billing_period,price_id,created_at) VALUES(?,?,?,?,?)",user,key,period,price,now);}
    public void saveCheckout(long user,String key,String session,String url) {store.update("UPDATE teacher_checkout_requests SET session_id=?,checkout_url=? WHERE user_id=? AND request_key=?",session,url,user,key);}
    public void finishCheckout(long user,String key,String status) {store.update("UPDATE teacher_checkout_requests SET status=? WHERE user_id=? AND request_key=?",status,user,key);}
    public boolean seenEvent(String id) {return store.count("SELECT COUNT(*) FROM teacher_billing_events WHERE event_id=?",id)>0;}
    public void recordEvent(String id,long user,String type,long created,Instant now) {store.update("INSERT INTO teacher_billing_events(event_id,user_id,event_type,provider_timestamp,created_at) VALUES(?,?,?,?,?)",id,user,type,created,now);}
    public void update(long user,String customer,String subscription,String status,Instant through,boolean cancel,Instant now) {store.update("UPDATE teacher_billing_accounts SET stripe_customer_id=?,stripe_subscription_id=?,provider_status=?,paid_through=?,cancel_at_period_end=?,updated_at=? WHERE user_id=?",customer,subscription,status,through,cancel,now,user);}
}
