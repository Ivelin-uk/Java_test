package com.quicktest.tests;

import com.quicktest.auth.AppUser;
import jakarta.persistence.*;
import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@Entity
@Getter
@Setter
@Table(name = "tests")
public class QuizTest {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(optional = false)
    private AppUser owner;

    @NotBlank
    private String title;

    @Column(length = 4000)
    private String description = "";

    private String language = "Bulgarian";

    @Enumerated(EnumType.STRING)
    private TestStatus status = TestStatus.DRAFT;

    @Enumerated(EnumType.STRING)
    private AccessType accessType = AccessType.PUBLIC;

    private String accessCode;
    private String publicCode;
    private Integer durationMinutes;
    private boolean questionOrderRandom;
    private boolean answerOrderRandom;
    private boolean showResult = true;
    private boolean showAnswers;
    private Instant publishedAt;
    private Instant createdAt = Instant.now();
    private Instant updatedAt = Instant.now();

    @OneToMany(mappedBy = "test", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("position ASC")
    private List<Question> questions = new ArrayList<>();

    @PreUpdate
    void touch() {
        updatedAt = Instant.now();
    }
}
