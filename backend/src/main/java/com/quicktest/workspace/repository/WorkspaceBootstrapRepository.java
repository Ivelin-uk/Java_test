package com.quicktest.workspace.repository;

import com.quicktest.workspace.WorkspaceStore;
import org.springframework.stereotype.Repository;

import java.util.*;

@Repository
public class WorkspaceBootstrapRepository {
    private final WorkspaceStore store;

    public WorkspaceBootstrapRepository(WorkspaceStore store) {
        this.store = store;
    }

    public long countPlans(Object value) {
        return store.count("SELECT COUNT(*) FROM organization_plans WHERE name=?", value);
    }

    public long insertPlan(Object[] plan) {
        return store.insert("INSERT INTO organization_plans(name,monthly_eur,yearly_eur,teacher_limit,student_limit,ai_limit,storage_bytes) VALUES(?,?,?,?,?,?,?)", plan);
    }
}
