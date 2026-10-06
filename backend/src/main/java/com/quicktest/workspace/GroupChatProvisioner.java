package com.quicktest.workspace;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import static com.quicktest.workspace.WorkspaceStore.*;

@Component @Order(100)
public class GroupChatProvisioner implements ApplicationRunner {
    private final WorkspaceStore db;private final TransactionTemplate transactions;
    public GroupChatProvisioner(WorkspaceStore db,TransactionTemplate transactions) {this.db=db;this.transactions=transactions;}
    @Override public void run(ApplicationArguments arguments) {
        for(var group:db.rows("SELECT id,organization_id FROM learning_groups WHERE status='active' ORDER BY id")) transactions.executeWithoutResult(tx->{
            long org=number(group,"organization_id"),id=number(group,"id");var locked=db.one("SELECT name FROM learning_groups WHERE organization_id=? AND id=? FOR UPDATE",org,id);
            var existing=db.optional("SELECT id FROM workspace_conversations WHERE organization_id=? AND group_id=? ORDER BY id LIMIT 1",org,id);
            long conversation=existing.map(c->number(c,"id")).orElseGet(()->db.insert("INSERT INTO workspace_conversations(organization_id,group_id,title) VALUES(?,?,?)",org,id,string(locked,"name")));
            for(var user:db.rows("SELECT g.user_id FROM group_members g JOIN memberships m ON m.organization_id=g.organization_id AND m.user_id=g.user_id WHERE g.organization_id=? AND g.group_id=? AND g.active=TRUE AND m.status='active' AND m.roles_json LIKE '%STUDENT%' UNION SELECT t.user_id FROM group_teachers t JOIN memberships m ON m.organization_id=t.organization_id AND m.user_id=t.user_id WHERE t.organization_id=? AND t.group_id=? AND m.status='active' AND m.roles_json LIKE '%TEACHER%'",org,id,org,id)) db.update("INSERT INTO conversation_members(organization_id,conversation_id,user_id) VALUES(?,?,?) ON DUPLICATE KEY UPDATE user_id=user_id",org,conversation,number(user,"user_id"));
        });
    }
}
