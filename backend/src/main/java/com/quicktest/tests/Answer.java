package com.quicktest.tests;

import jakarta.persistence.*;
import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.Setter;

@Entity
@Getter
@Setter
public class Answer {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(optional = false)
    private Question question;

    @NotBlank
    @Column(length = 2000)
    private String answer;

    private boolean correct;
    private int position;
}
