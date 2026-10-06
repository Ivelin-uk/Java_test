package com.quicktest.workspace;

import com.quicktest.access.EndpointPolicy;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController @RequestMapping("/api/v1/question-bank")
@EndpointPolicy(mode=EndpointPolicy.Mode.TENANT) @PreAuthorize("isAuthenticated()")
public class QuestionBankController {
    private final OrgAccess access;private final QuestionBankService bank;
    public QuestionBankController(OrgAccess access,QuestionBankService bank) {this.access=access;this.bank=bank;}
    @GetMapping public Object list() {return bank.list(access.teacher());}
    @PostMapping public Object save(@RequestBody QuestionBankService.Item request) {return bank.save(access.teacher(),request);}
    @DeleteMapping("/{id}") public void remove(@PathVariable long id) {bank.remove(access.teacher(),id);}
}
