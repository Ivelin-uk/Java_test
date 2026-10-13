package com.quicktest.dashboard;

import com.quicktest.auth.AuthService;
import com.quicktest.access.EndpointPolicy;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/dashboard")
public class DashboardController {
    private final AuthService authService;
    private final DashboardService dashboardService;

    public DashboardController(AuthService authService, DashboardService dashboardService) {
        this.authService = authService;
        this.dashboardService = dashboardService;
    }

    @GetMapping
    @EndpointPolicy
    @PreAuthorize("@permissions.check(authentication, 'DashboardController.dashboard')")
    public DashboardResponse dashboard(@RequestHeader("Authorization") String authorization) {
        return dashboardService.dashboard(authService.requireUser(authorization));
    }
}
