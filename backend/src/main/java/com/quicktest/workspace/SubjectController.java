package com.quicktest.workspace;

import com.quicktest.access.EndpointPolicy;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1/subjects")
@EndpointPolicy(mode = EndpointPolicy.Mode.TENANT)
@PreAuthorize("isAuthenticated()")
public class SubjectController {
    private final OrgAccess access;
    private final SubjectService subjects;

    public SubjectController(OrgAccess access, SubjectService subjects) { this.access = access; this.subjects = subjects; }

    @GetMapping
    public List<SubjectService.Subject> list() { return subjects.list(access.teacher()); }

    @PostMapping
    public SubjectService.Subject create(@Valid @RequestBody CreateSubject request) { return subjects.create(access.teacher(), request.name()); }

    public record CreateSubject(@NotBlank @Size(max = 190) String name) {}
}
