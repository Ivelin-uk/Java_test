package com.quicktest.workspace;

import org.springframework.stereotype.Service;
import java.time.Clock;
import java.util.Map;

@Service
public class WorkspaceAudit {
    private final WorkspaceStore db;
    private final Clock clock;
    public WorkspaceAudit(WorkspaceStore db, Clock clock) { this.db = db; this.clock = clock; }
    public void write(Long organization, long actor, String action, Long resource, Map<String, ?> detail) {
        db.insert("INSERT INTO workspace_audit(organization_id,actor_id,action,resource_id,detail_json,created_at) VALUES(?,?,?,?,?,?)", organization, actor, action, resource, db.json(detail), clock.instant());
    }
}
