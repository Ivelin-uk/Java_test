package com.quicktest.demo;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class DemoSeedRepository {
    private final JdbcTemplate jdbc;

    public DemoSeedRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public boolean hasRun(String seedKey) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM demo_seed_history WHERE seed_key = ?", Long.class, seedKey) > 0;
    }

    public void record(String seedKey) {
        jdbc.update("INSERT INTO demo_seed_history (seed_key, created_at) VALUES (?, CURRENT_TIMESTAMP)", seedKey);
    }
}
