package com.quicktest.workspace;

import com.quicktest.access.EndpointPolicy;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
@EndpointPolicy(mode=EndpointPolicy.Mode.TENANT,teacher=false,student=true)
@PreAuthorize("isAuthenticated()")
public class AttemptController {
    private final OrgAccess access;private final AttemptService attempts;private final HttpServletRequest http;
    public AttemptController(OrgAccess access,AttemptService attempts,HttpServletRequest http) {this.access=access;this.attempts=attempts;this.http=http;}
    private AttemptService.Session session() {return new AttemptService.Session(http.getHeader("X-Exam-Session"),http.getHeader("X-Exam-Browser"),access.authSession());}
    @PostMapping("/assignments/{id}/attempts") public Object start(@PathVariable long id,@RequestBody AttemptService.StartRequest request) {var scope=access.student();mobileGuard(scope,id);return attempts.start(scope,id,request,access.authSession(),access.remoteAddress());}
    @GetMapping("/attempts") public Object mine() {return attempts.mine(access.student());}
    @GetMapping("/attempts/{id}/state") public Object state(@PathVariable long id) {return attempts.getState(access.student(),id,session());}
    @PostMapping("/attempts/{id}/questions/open") public Object open(@PathVariable long id,@RequestBody AttemptService.Ready request) {return attempts.open(access.student(),id,session(),request);}
    @PutMapping("/attempts/{id}/questions/{question}/draft") public Object draft(@PathVariable long id,@PathVariable long question,@RequestBody AttemptService.AnswerRequest request) {return attempts.draft(access.student(),id,question,session(),request);}
    @PostMapping("/attempts/{id}/questions/{question}/answer") public Object answer(@PathVariable long id,@PathVariable long question,@RequestBody AttemptService.AnswerRequest request) {return attempts.answer(access.student(),id,question,session(),request);}
    @PostMapping("/attempts/{id}/events") public Object event(@PathVariable long id,@RequestBody AttemptService.Event request) {return attempts.event(access.student(),id,session(),request);}
    @PostMapping("/attempts/{id}/submit") public Object submit(@PathVariable long id) {return attempts.submit(access.student(),id,session());}
    @PostMapping("/attempts/{id}/session/transfer") public Object transfer(@PathVariable long id,@RequestBody Transfer request) {return attempts.transfer(access.student(),id,request.session(),request.password(),access.authSession());}
    public record Transfer(String password,AttemptService.StartRequest session) {}
    @org.springframework.beans.factory.annotation.Value("${app.exam.mobile-validated:false}") private boolean mobileValidated;
    private void mobileGuard(OrgAccess.Scope scope,long assignment) {
        boolean mobile="?1".equals(http.getHeader("Sec-CH-UA-Mobile")) || java.util.regex.Pattern.compile("Mobile|Android|iPhone|iPad",java.util.regex.Pattern.CASE_INSENSITIVE).matcher(java.util.Objects.toString(http.getHeader("User-Agent"),"")).find();
        if(mobile && !mobileValidated && !WorkspaceStore.flag(attempts.recipient(scope,assignment),"fullscreen_exempt")) throw WorkspaceError.conflict("Мобилният строг режим не е валидиран. Опит не е изразходван.");
    }
}
