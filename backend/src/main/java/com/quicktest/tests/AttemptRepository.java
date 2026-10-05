package com.quicktest.tests;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface AttemptRepository extends JpaRepository<Attempt, Long> {
    List<Attempt> findByTestOwnerIdOrderBySubmittedAtDesc(Long ownerId);
    List<Attempt> findByTestIdAndTestOwnerIdOrderBySubmittedAtDesc(Long testId, Long ownerId);
    long countByTestOwnerId(Long ownerId);
    boolean existsByTestIdAndParticipantEmail(Long testId, String participantEmail);
}
