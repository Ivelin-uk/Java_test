package com.quicktest.workspace;

import com.quicktest.workspace.repository.AuditRepository;

import org.springframework.stereotype.Service;
import java.time.Clock;
import java.util.Map;

@Service
public class WorkspaceAudit {
    private final WorkspaceJson json;
    private final AuditRepository repository;
    private final Clock clock;
    public WorkspaceAudit(AuditRepository repository,WorkspaceJson json, Clock clock) { this.repository = repository;this.json=json; this.clock = clock; }
    public void write(Long organization, long actor, String action, Long resource, Map<String, ?> detail) {
        repository.insertEntry(organization, actor, action, resource, json.write(detail), clock.instant());
    }
}
