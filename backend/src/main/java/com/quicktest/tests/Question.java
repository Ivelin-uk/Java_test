package com.quicktest.tests;

import jakarta.persistence.*;
import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

@Entity
@Getter
@Setter
public class Question {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(optional = false)
    private QuizTest test;

    @Enumerated(EnumType.STRING)
    private QuestionType type;

    @NotBlank
    @Column(length = 4000)
    private String question;

    @Enumerated(EnumType.STRING)
    private Difficulty difficulty = Difficulty.MEDIUM;

    private int points = 1;

    @Column(length = 4000)
    private String explanation = "";

    private int position;

    @OneToMany(mappedBy = "question", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("position ASC")
    private List<Answer> answers = new ArrayList<>();
}
