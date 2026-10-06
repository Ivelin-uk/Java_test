package com.quicktest.ai;

import com.quicktest.auth.AuthService;
import com.quicktest.access.EndpointPolicy;
import org.springframework.security.access.prepost.PreAuthorize;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/ai")
public class AiController {
    private final AuthService authService;
    private final AiService aiService;

    public AiController(AuthService authService, AiService aiService) {
        this.authService = authService;
        this.aiService = aiService;
    }

    @PostMapping("/generate-test")
    @EndpointPolicy(paid = true)
    @PreAuthorize("@permissions.check(authentication, 'AiController.generateTest')")
    public AiService.AiGeneratedTestResponse generateTest(@RequestHeader("Authorization") String authorization, @Valid @RequestBody AiService.AiGenerateTestRequest request) {
        return aiService.generateTest(authService.requireUser(authorization), request);
    }
}
