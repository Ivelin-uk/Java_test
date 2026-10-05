package com.quicktest.ai;

import com.quicktest.auth.AppUser;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.Instant;

@Entity
@Getter
@Setter
public class AiUsage {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(optional = false)
    private AppUser user;

    private String operation;
    private String model;
    private int inputTokens;
    private int outputTokens;
    private BigDecimal estimatedCost = BigDecimal.ZERO;
    private Instant createdAt = Instant.now();
}
