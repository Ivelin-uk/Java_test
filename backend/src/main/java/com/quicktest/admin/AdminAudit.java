package com.quicktest.admin;

import com.quicktest.auth.AppUser;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.Instant;

@Entity
@Getter
@Setter
public class AdminAudit {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @ManyToOne(optional = false)
    private AppUser actor;
    @ManyToOne
    private AppUser targetUser;
    @Column(nullable = false, length = 100)
    private String action;
    @Column(nullable = false, length = 1000)
    private String details;
    @Column(nullable = false)
    private Instant createdAt = Instant.now();
}
