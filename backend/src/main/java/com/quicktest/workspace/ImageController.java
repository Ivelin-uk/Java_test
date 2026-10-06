package com.quicktest.workspace;

import com.quicktest.access.EndpointPolicy;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController @RequestMapping("/api/v1/files") @EndpointPolicy(mode=EndpointPolicy.Mode.TENANT,student=true) @PreAuthorize("isAuthenticated()")
public class ImageController {
    private final OrgAccess access;private final PrivateImageService files;private final HttpServletRequest request;
    public ImageController(OrgAccess access,PrivateImageService files,HttpServletRequest request) {this.access=access;this.files=files;this.request=request;}
    @PostMapping @EndpointPolicy(mode=EndpointPolicy.Mode.TENANT) public Object upload(@RequestBody PrivateImageService.Upload input) {var scope=access.scope();if(!scope.roles().contains("TEACHER") && !scope.roles().contains("ORG_ADMIN")) throw WorkspaceError.forbidden();return files.upload(scope,input);}
    @GetMapping("/{id}") public ResponseEntity<byte[]> download(@PathVariable long id,@RequestParam(required=false) Long attempt) {
        var image=files.download(access.scope(),id,attempt,new AttemptService.Session(request.getHeader("X-Exam-Session"),request.getHeader("X-Exam-Browser"),access.authSession()));
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(image.mime())).header("X-Content-Type-Options","nosniff").cacheControl(CacheControl.noStore()).body(image.content());
    }
}
