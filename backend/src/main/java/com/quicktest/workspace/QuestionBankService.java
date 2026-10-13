package com.quicktest.workspace;

import com.quicktest.workspace.repository.QuestionBankRepository;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Clock;
import java.util.*;
import static com.quicktest.workspace.WorkspaceValues.*;

@Service
public class QuestionBankService {
    private final WorkspaceJson json;
    private final QuestionBankRepository repository; private final AssessmentService assessments; private final WorkspaceAudit audit; private final Clock clock;private final PrivateImageService images;
    public QuestionBankService(QuestionBankRepository repository,WorkspaceJson json,AssessmentService assessments,WorkspaceAudit audit,Clock clock,PrivateImageService images) {this.repository=repository;this.json=json;this.assessments=assessments;this.audit=audit;this.clock=clock;this.images=images;}
    public Object list(OrgAccess.Scope scope) {return repository.findVisibleItems(scope.organizationId(), scope.platform(), scope.userId());}
    @Transactional public Object save(OrgAccess.Scope scope,Item request) {
        assessments.validateQuestion(request.question());
        images.validateQuestionImage(scope,request.question().imageId());
        if(request.subject()==null || request.subject().length()>190) throw WorkspaceError.validation("Невалиден предмет.");
        long id=repository.insertItem(scope.organizationId(), scope.userId(), request.subject(), request.shared(), json.write(request.question()), clock.instant());
        audit.write(scope.organizationId(),scope.userId(),"question_bank.saved",id,Map.of("shared",request.shared()));return repository.requireItem(scope.organizationId(), id);
    }
    @Transactional public void remove(OrgAccess.Scope scope,long id) {
        var item=repository.requireOwner(scope.organizationId(), id);
        if(number(item,"owner_id")!=scope.userId()) throw WorkspaceError.forbidden();
        repository.deleteItem(scope.organizationId(), id);audit.write(scope.organizationId(),scope.userId(),"question_bank.removed",id,Map.of());
    }
    public record Item(String subject,boolean shared,AssessmentService.Question question) {}
}
