package com.quicktest.workspace;

import com.quicktest.auth.AppUser;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Clock;
import java.time.Instant;
import java.util.*;
import static com.quicktest.workspace.WorkspaceStore.*;

@Service
public class PersonalWorkspace {
    private final WorkspaceStore db;
    private final Clock clock;
    public PersonalWorkspace(WorkspaceStore db, Clock clock) {this.db=db;this.clock=clock;}

    // Existing composite foreign keys retain their namespace; accounts no longer select or join it.
    @Transactional
    public long workspace(AppUser user) {
        db.one("SELECT id FROM users WHERE id=? FOR UPDATE",user.getId());
        var existing=db.optional("SELECT organization_id FROM personal_workspaces WHERE user_id=?",user.getId());
        if(existing.isPresent()) return number(existing.get(),"organization_id");
        long id=db.insert("INSERT INTO organizations(name,organization_type,contact_email,timezone,student_label,settings_json,created_at) VALUES(?,'personal',?,'Europe/Sofia',?,?,?)",
                user.getName(),user.getEmail(),"Ученик / студент",db.json(Map.of("gradingScale","bulgarian","passThreshold",50)),clock.instant());
        db.update("INSERT INTO personal_workspaces(user_id,organization_id) VALUES(?,?)",user.getId(),id);
        long plan=number(db.one("SELECT id FROM organization_plans WHERE name='Starter'"),"id");
        db.update("INSERT INTO organization_subscriptions(organization_id,plan_id,status,paid_through,period_start) VALUES(?,?,'active',?,?)",
                id,plan,Instant.parse("9999-01-01T00:00:00Z"),clock.instant());
        member(id,user.getId(),user.getRole().name());
        return id;
    }

    @Transactional
    public void member(long workspace,long user,String role) {
        db.update("INSERT INTO memberships(organization_id,user_id,roles_json,created_at) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE roles_json=VALUES(roles_json),status='active'",
                workspace,user,db.json(List.of(role)),clock.instant());
    }
}
