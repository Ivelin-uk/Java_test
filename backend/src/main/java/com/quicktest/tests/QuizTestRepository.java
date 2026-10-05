package com.quicktest.tests;

import com.quicktest.auth.AppUser;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface QuizTestRepository extends JpaRepository<QuizTest, Long> {
    List<QuizTest> findByOwnerOrderByUpdatedAtDesc(AppUser owner);
    Optional<QuizTest> findByIdAndOwner(Long id, AppUser owner);
    Optional<QuizTest> findByPublicCodeAndStatus(String publicCode, TestStatus status);
    long countByOwner(AppUser owner);
    long countByOwnerAndStatus(AppUser owner, TestStatus status);
}
