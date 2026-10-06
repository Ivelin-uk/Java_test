package com.quicktest.access;

import com.quicktest.auth.Role;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

@Entity
@Getter
@Setter
@Table(uniqueConstraints = @UniqueConstraint(columnNames = {"endpointKey", "role"}))
public class EndpointPermission {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(nullable = false, length = 160)
    private String endpointKey;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20)
    private Role role;
    private boolean allowed;
    private boolean subscriptionRequired;
}
