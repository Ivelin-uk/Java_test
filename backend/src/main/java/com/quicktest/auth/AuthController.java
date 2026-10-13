package com.quicktest.auth;

import jakarta.validation.Valid;
import com.quicktest.access.EndpointPolicy;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final AuthWorkflowService service;
    private final jakarta.servlet.http.HttpServletRequest http;

    public AuthController(AuthWorkflowService service,jakarta.servlet.http.HttpServletRequest http) {
        this.service = service;
        this.http=http;
    }

    @PostMapping("/register")
    @EndpointPolicy(mode = EndpointPolicy.Mode.PUBLIC)
    public AuthService.AuthResponse register(@Valid @RequestBody AuthService.RegisterRequest request) {
        return service.register(request,http.getRemoteAddr());
    }

    @PostMapping("/login")
    @EndpointPolicy(mode = EndpointPolicy.Mode.PUBLIC)
    public AuthService.AuthResponse login(@Valid @RequestBody AuthService.LoginRequest request) {
        return service.login(request,http.getRemoteAddr());
    }

    @GetMapping("/me")
    @EndpointPolicy(mode = EndpointPolicy.Mode.PROFILE)
    @PreAuthorize("isAuthenticated()")
    public AuthService.UserResponse me(@RequestHeader("Authorization") String authorization) {
        return service.me(authorization);
    }

    @PostMapping("/role")
    @EndpointPolicy(mode = EndpointPolicy.Mode.PROFILE)
    @PreAuthorize("isAuthenticated()")
    public AuthService.UserResponse selectRole(@RequestHeader("Authorization") String authorization,
                                               @Valid @RequestBody AuthService.SelectRoleRequest request) {
        return service.selectRole(authorization, request);
    }

    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @EndpointPolicy(mode = EndpointPolicy.Mode.PROFILE)
    @PreAuthorize("isAuthenticated()")
    public void logout(@RequestHeader("Authorization") String authorization) {
        service.logout(authorization);
    }
    @PostMapping("/logout-all") @ResponseStatus(HttpStatus.NO_CONTENT) @EndpointPolicy(mode=EndpointPolicy.Mode.PROFILE) @PreAuthorize("isAuthenticated()")
    public void logoutAll(@RequestHeader("Authorization") String authorization) {service.logoutAll(authorization);}

    @PostMapping("/password")
    @EndpointPolicy(mode = EndpointPolicy.Mode.PROFILE)
    @PreAuthorize("isAuthenticated()")
    public AuthService.AuthResponse password(@RequestHeader("Authorization") String authorization,
                                             @Valid @RequestBody AuthService.ChangePasswordRequest request) {
        return service.changePassword(authorization, request);
    }

    @PostMapping("/recover")
    @EndpointPolicy(mode = EndpointPolicy.Mode.PUBLIC)
    public void recover(@Valid @RequestBody RecoverRequest request) {
        service.recover(request.email(),http.getRemoteAddr());
    }

    @PostMapping("/reset")
    @EndpointPolicy(mode = EndpointPolicy.Mode.PUBLIC)
    public void reset(@RequestBody ResetRequest request) {service.reset(request.token(),request.password(),http.getRemoteAddr());}
    public record ResetRequest(String token, String password) {}
    public record RecoverRequest(@jakarta.validation.constraints.Email @jakarta.validation.constraints.NotBlank String email) {}
}
