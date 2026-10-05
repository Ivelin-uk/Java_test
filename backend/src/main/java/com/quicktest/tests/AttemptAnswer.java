package com.quicktest.tests;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

@Entity
@Getter
@Setter
public class AttemptAnswer {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(optional = false)
    private Attempt attempt;

    @ManyToOne(optional = false)
    private Question question;

    private String selectedAnswerIds;

    @Column(length = 4000)
    private String textAnswer;

    private boolean correct;
    private int pointsAwarded;
}
