package com.quicktest.tests;

import com.quicktest.auth.AppUser;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@Entity
@Getter
@Setter
public class Attempt {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(optional = false)
    private QuizTest test;

    @ManyToOne
    private AppUser user;

    private String participantName;
    private String participantEmail;
    private Instant startedAt = Instant.now();
    private Instant submittedAt;
    private int score;
    private int maxScore;
    private double percentage;
    private String grade;

    @OneToMany(mappedBy = "attempt", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<AttemptAnswer> answers = new ArrayList<>();
}
