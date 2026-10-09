package com.quicktest.workspace;

import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Component
@Order(200)
public class WorkspaceDemo implements CommandLineRunner {
    private final WorkspaceStore db;

    public WorkspaceDemo(WorkspaceStore db) {
        this.db = db;
    }

    @Override
    @Transactional
    public void run(String... args) {
        // Personal workspaces need these plans even when demo accounts are disabled.
        for (Object[] plan : List.of(
                new Object[]{"Starter", 19, 190, 5, 100, 50, 1_000_000_000L},
                new Object[]{"School", 69, 690, 30, 1000, 300, 10_000_000_000L},
                new Object[]{"University", 199, 1990, 200, 10000, 2000, 100_000_000_000L})) {
            if (db.count("SELECT COUNT(*) FROM organization_plans WHERE name=?", plan[0]) == 0) {
                db.insert("INSERT INTO organization_plans(name,monthly_eur,yearly_eur,teacher_limit,student_limit,ai_limit,storage_bytes) VALUES(?,?,?,?,?,?,?)", plan);
            }
        }
    }
}
