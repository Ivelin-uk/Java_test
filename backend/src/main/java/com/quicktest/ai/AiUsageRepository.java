package com.quicktest.ai;

import com.quicktest.auth.AppUser;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AiUsageRepository extends JpaRepository<AiUsage, Long> {
    long countByUser(AppUser user);
}
