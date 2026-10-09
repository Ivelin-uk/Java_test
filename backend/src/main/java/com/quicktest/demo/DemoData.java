package com.quicktest.demo;

import com.quicktest.auth.AppUser;
import com.quicktest.auth.AppUserRepository;
import com.quicktest.auth.Role;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;

@Component
@Order(100)
public class DemoData implements CommandLineRunner {
    private static final String SEED_KEY = "demo-accounts-v2";
    private final boolean seed;
    private final AppUserRepository users;
    private final JdbcTemplate jdbc;
    private final PasswordEncoder passwordEncoder;

    public DemoData(@Value("${app.demo-seed}") boolean seed, AppUserRepository users,
                    JdbcTemplate jdbc, PasswordEncoder passwordEncoder) {
        this.seed = seed;
        this.users = users;
        this.jdbc = jdbc;
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    @Transactional
    public void run(String... args) {
        if (!seed || jdbc.queryForObject("SELECT COUNT(*) FROM demo_seed_history WHERE seed_key = ?",
                Long.class, SEED_KEY) > 0) {
            return;
        }
        seedUser("admin@quicktest.local", "Demo Administrator", Role.ADMIN);
        seedUser("teacher@quicktest.local", "Demo Teacher", Role.TEACHER);
        seedUser("student@quicktest.local", "Demo Student 1", Role.STUDENT);
        seedUser("student2@quicktest.local", "Demo Student 2", Role.STUDENT);
        jdbc.update("INSERT INTO demo_seed_history (seed_key, created_at) VALUES (?, CURRENT_TIMESTAMP)", SEED_KEY);
    }

    private void seedUser(String email, String name, Role role) {
        if (users.existsByEmailIgnoreCase(email)) return;
        AppUser user = new AppUser();
        user.setName(name);
        user.setEmail(email);
        user.setRole(role);
        user.setEmailVerifiedAt(Instant.now());
        user.setPasswordHash(passwordEncoder.encode("password123"));
        if (role == Role.TEACHER) {
            user.setSubscriptionPaid(true);
            user.setSubscriptionPaidAt(Instant.now());
            user.setSubscriptionPaidUntil(LocalDate.now(ZoneId.of("Europe/Sofia")).plusDays(30));
        }
        users.save(user);
    }
}
