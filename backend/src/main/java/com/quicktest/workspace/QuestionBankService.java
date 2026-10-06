package com.quicktest.workspace;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Clock;
import java.util.*;
import static com.quicktest.workspace.WorkspaceStore.*;

@Service
public class QuestionBankService {
    private final WorkspaceStore db; private final AssessmentService assessments; private final WorkspaceAudit audit; private final Clock clock;private final PrivateImageService images;
    public QuestionBankService(WorkspaceStore db,AssessmentService assessments,WorkspaceAudit audit,Clock clock,PrivateImageService images) {this.db=db;this.assessments=assessments;this.audit=audit;this.clock=clock;this.images=images;}
    public Object list(OrgAccess.Scope scope) {return db.rows("SELECT * FROM question_bank_items WHERE organization_id=? AND (owner_id=? OR shared=TRUE) ORDER BY id DESC",scope.organizationId(),scope.userId());}
    @Transactional public Object save(OrgAccess.Scope scope,Item request) {
        assessments.validateQuestion(request.question());
        images.validateQuestionImage(scope,request.question().imageId());
        if(request.subject()==null || request.subject().length()>190) throw WorkspaceError.validation("Невалиден предмет.");
        long id=db.insert("INSERT INTO question_bank_items(organization_id,owner_id,subject,shared,definition_json,created_at) VALUES(?,?,?,?,?,?)",scope.organizationId(),scope.userId(),request.subject(),request.shared(),db.json(request.question()),clock.instant());
        audit.write(scope.organizationId(),scope.userId(),"question_bank.saved",id,Map.of("shared",request.shared()));return db.one("SELECT * FROM question_bank_items WHERE organization_id=? AND id=?",scope.organizationId(),id);
    }
    @Transactional public void remove(OrgAccess.Scope scope,long id) {
        var item=db.one("SELECT owner_id FROM question_bank_items WHERE organization_id=? AND id=?",scope.organizationId(),id);
        if(number(item,"owner_id")!=scope.userId()) throw WorkspaceError.forbidden();
        db.update("DELETE FROM question_bank_items WHERE organization_id=? AND id=?",scope.organizationId(),id);audit.write(scope.organizationId(),scope.userId(),"question_bank.removed",id,Map.of());
    }
    public record Item(String subject,boolean shared,AssessmentService.Question question) {}
}
