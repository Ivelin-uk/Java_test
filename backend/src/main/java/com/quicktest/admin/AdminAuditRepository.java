package com.quicktest.admin;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface AdminAuditRepository extends JpaRepository<AdminAudit, Long> {
    List<AdminAudit> findTop200ByOrderByCreatedAtDescIdDesc();
}
