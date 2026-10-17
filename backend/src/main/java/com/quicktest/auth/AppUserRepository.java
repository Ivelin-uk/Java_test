package com.quicktest.auth;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.List;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface AppUserRepository extends JpaRepository<AppUser, Long> {
    Optional<AppUser> findByEmailIgnoreCase(String email);
    boolean existsByEmailIgnoreCase(String email);
    List<AppUser> findAllByOrderByCreatedAtDesc();

    @Query(value = "SELECT * FROM users WHERE id = :id FOR UPDATE", nativeQuery = true)
    Optional<AppUser> lockById(@org.springframework.data.repository.query.Param("id") Long id);

    // MySQL 5.7 needs plain FOR UPDATE; Hibernate 7 emits the newer FOR UPDATE OF syntax.
    @Query(value = "SELECT * FROM users WHERE role = 'ADMIN' ORDER BY id FOR UPDATE", nativeQuery = true)
    List<AppUser> lockAdministrators();

    // Dependency cleanup uses JDBC; discard managed references to the removed graph afterwards.
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("DELETE FROM AppUser user WHERE user.id = :id")
    void deletePermanentlyById(@org.springframework.data.repository.query.Param("id") Long id);
}
