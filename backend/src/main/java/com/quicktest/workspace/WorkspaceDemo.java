package com.quicktest.workspace;

import com.quicktest.workspace.repository.WorkspaceBootstrapRepository;

import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Component
@Order(200)
public class WorkspaceDemo implements CommandLineRunner {
    private final WorkspaceBootstrapRepository repository;

    public WorkspaceDemo(WorkspaceBootstrapRepository repository) {
        this.repository = repository;
    }

    @Override
    @Transactional
    public void run(String... args) {
        // Personal workspaces need these plans even when demo accounts are disabled.
        for (Object[] plan : List.of(
                new Object[]{"Starter", 19, 190, 5, 100, 50, 1_000_000_000L},
                new Object[]{"School", 69, 690, 30, 1000, 300, 10_000_000_000L},
                new Object[]{"University", 199, 1990, 200, 10000, 2000, 100_000_000_000L})) {
            if (repository.countPlans(plan[0]) == 0) {
                repository.insertPlan(plan);
            }
        }
    }
}
