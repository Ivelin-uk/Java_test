package com.quicktest.workspace;

import com.quicktest.access.EndpointPolicy;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1/subjects")
@EndpointPolicy(mode = EndpointPolicy.Mode.TENANT)
@PreAuthorize("isAuthenticated()")
public class SubjectController {
    private final OrgAccess access;
    private final SubjectService subjects;
    private final SyllabusImportService syllabusImports;

    public SubjectController(OrgAccess access, SubjectService subjects, SyllabusImportService syllabusImports) {
        this.access = access;
        this.subjects = subjects;
        this.syllabusImports = syllabusImports;
    }

    @GetMapping
    public List<SubjectService.Subject> list() { return subjects.list(access.teacher()); }

    @GetMapping("/topics")
    public List<String> topics(@RequestParam String subject, @RequestParam(defaultValue = "") String level) {
        return subjects.topics(access.teacher(), subject, level);
    }

    @GetMapping("/topics/personal")
    public List<String> personalTopics(@RequestParam String subject, @RequestParam(defaultValue = "") String level) {
        return subjects.personalTopics(access.teacher(), subject, level);
    }

    @PostMapping("/topics")
    public SavedTopic createTopic(@Valid @RequestBody CreateTopic request) {
        return new SavedTopic(subjects.createTopic(access.teacher(), request.subject(), request.name(), request.level()));
    }

    @DeleteMapping("/topics")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteTopic(@RequestParam String subject, @RequestParam String name, @RequestParam(defaultValue = "") String level) {
        subjects.deleteTopic(access.teacher(), subject, name, level);
    }

    @PostMapping("/syllabus-import")
    public ResponseEntity<SyllabusImportService.SyllabusDraft> importSyllabus(@Valid @RequestBody SourceMaterialService.Upload request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(syllabusImports.extract(access.teacher(), request));
    }

    @PostMapping("/syllabus-import/confirm")
    public SyllabusImportService.SavedSyllabus confirmSyllabus(@Valid @RequestBody SyllabusImportService.ConfirmSyllabus request) {
        return syllabusImports.confirm(access.teacher(), request);
    }

    @PostMapping
    public SubjectService.Subject create(@Valid @RequestBody CreateSubject request) { return subjects.create(access.teacher(), request.name()); }

    @DeleteMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@RequestParam String name) { subjects.delete(access.teacher(), name); }

    public record CreateSubject(@NotBlank @Size(max = 190) String name) {}
    public record CreateTopic(@NotBlank @Size(max = 190) String subject, @NotBlank @Size(max = 190) String name,
                              @jakarta.validation.constraints.Pattern(regexp = "|[1-9]|1[0-2]") String level) {}
    public record SavedTopic(String name) {}
}
