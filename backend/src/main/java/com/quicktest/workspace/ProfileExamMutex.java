package com.quicktest.workspace;

import com.quicktest.workspace.repository.ProfileExamLockRepository;

import org.springframework.stereotype.Component;

@Component
public class ProfileExamMutex {
    private final ProfileExamLockRepository repository;
    public ProfileExamMutex(ProfileExamLockRepository repository) { this.repository=repository; }
    public void lock(long user) {
        // A dedicated row avoids taking exclusive locks on a parent of all memberships.
        repository.ensureLock(user);
        repository.lockProfile(user);
    }
}
