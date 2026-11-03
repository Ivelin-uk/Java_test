package com.quicktest.admin;

import com.quicktest.access.EndpointPolicy;
import com.quicktest.auth.AuthService;
import com.quicktest.workspace.SubjectCatalogAdminService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/admin/subjects")
@EndpointPolicy(mode = EndpointPolicy.Mode.ADMIN)
@PreAuthorize("hasRole('ADMIN')")
public class AdminSubjectController {
    private final AuthService auth;
    private final SubjectCatalogAdminService catalog;

    public AdminSubjectController(AuthService auth, SubjectCatalogAdminService catalog) { this.auth = auth; this.catalog = catalog; }

    @GetMapping
    public List<SubjectCatalogAdminService.CatalogSubject> subjects(@RequestHeader("Authorization") String authorization) {
        return catalog.subjects(auth.requireUser(authorization));
    }

    @PostMapping
    public SubjectCatalogAdminService.CatalogSubject createSubject(@RequestHeader("Authorization") String authorization, @Valid @RequestBody SubjectEdit request) {
        return catalog.createSubject(auth.requireUser(authorization), request.name());
    }

    @PutMapping("/{id}")
    public SubjectCatalogAdminService.CatalogSubject updateSubject(@RequestHeader("Authorization") String authorization, @PathVariable long id, @Valid @RequestBody SubjectEdit request) {
        return catalog.updateSubject(auth.requireUser(authorization), id, request.name());
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteSubject(@RequestHeader("Authorization") String authorization, @PathVariable long id) {
        catalog.deleteSubject(auth.requireUser(authorization), id);
    }

    @GetMapping("/{subjectId}/topics")
    public List<SubjectCatalogAdminService.CatalogTopic> topics(@RequestHeader("Authorization") String authorization, @PathVariable long subjectId) {
        return catalog.topics(auth.requireUser(authorization), subjectId);
    }

    @PostMapping("/{subjectId}/topics")
    public SubjectCatalogAdminService.CatalogTopic createTopic(@RequestHeader("Authorization") String authorization, @PathVariable long subjectId, @Valid @RequestBody TopicEdit request) {
        return catalog.createTopic(auth.requireUser(authorization), subjectId, request.name(), request.level());
    }

    @PutMapping("/{subjectId}/topics/{id}")
    public SubjectCatalogAdminService.CatalogTopic updateTopic(@RequestHeader("Authorization") String authorization, @PathVariable long subjectId, @PathVariable long id, @Valid @RequestBody TopicEdit request) {
        return catalog.updateTopic(auth.requireUser(authorization), subjectId, id, request.name(), request.level());
    }

    @DeleteMapping("/{subjectId}/topics/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteTopic(@RequestHeader("Authorization") String authorization, @PathVariable long subjectId, @PathVariable long id) {
        catalog.deleteTopic(auth.requireUser(authorization), subjectId, id);
    }

    public record SubjectEdit(@NotBlank @Size(max = 190) String name) {}
    public record TopicEdit(@NotBlank @Size(max = 190) String name, @Pattern(regexp = "|[1-9]|1[0-2]") String level) {}
}
