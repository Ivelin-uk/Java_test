package com.quicktest.auth;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;

@Entity
@Getter
@Setter
public class AuthToken {
    @Id
    private String token;

    @ManyToOne(optional = false)
    private AppUser user;

    private Instant createdAt = Instant.now();
}
