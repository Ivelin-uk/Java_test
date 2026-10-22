package com.quicktest.workspace;

import com.quicktest.workspace.repository.AssessmentRepository;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import org.springframework.stereotype.Service;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import java.util.*;
import static com.quicktest.workspace.WorkspaceValues.*;

@Service
public class AssessmentImportService {
    private final AssessmentRepository repository;
    private final AssessmentService assessments;
    private final PrivateImageService images;
    private final OrganizationService organizations;
    private final WorkspaceJson json;
    private final WorkspaceAudit audit;
    private final CodeRateLimiter limiter;
    private final TransactionTemplate transaction;

    public AssessmentImportService(AssessmentRepository repository,AssessmentService assessments,PrivateImageService images,OrganizationService organizations,WorkspaceJson json,WorkspaceAudit audit,CodeRateLimiter limiter,TransactionTemplate transactions) {
        this.repository=repository;this.assessments=assessments;this.images=images;this.organizations=organizations;this.json=json;this.audit=audit;this.limiter=limiter;
        this.transaction=new TransactionTemplate(transactions.getTransactionManager());
        this.transaction.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
    }
    public record Request(@NotBlank @Pattern(regexp="[1-9][0-9]{11}") String number) {}

    public Map<String,Object> importTest(OrgAccess.Scope scope,Request request,String ip) {
        if(!scope.roles().contains("TEACHER")) throw WorkspaceError.forbidden();
        String value=request.number()==null?"":request.number().strip();
        if(!value.matches("[1-9][0-9]{11}")) throw unavailable();
        var candidate=repository.findImportSource(value);
        // Guess accounting must commit before opening the import transaction.
        if(!limiter.checkTestImport(scope.userId(),ip,candidate.isPresent())) throw limiter.limited();
        if(candidate.isEmpty()) throw unavailable();
        return transaction.execute(tx->{
            organizations.requireActiveMember(scope,scope.userId(),"TEACHER");
            // Serialize repeated imports before checking for an existing own copy.
            organizations.lockQuota(scope.organizationId());
            long sourceOrg=number(candidate.get(),"organization_id"),sourceId=number(candidate.get(),"id");
            repository.lockTest(sourceOrg,sourceId);
            var source=repository.findImportSource(value).orElseThrow(this::unavailable);
            if(number(source,"owner_id")==scope.userId() && sourceOrg==scope.organizationId()) return assessments.get(scope,sourceId,true);
            var previous=repository.findImportedTest(scope.organizationId(),scope.userId(),sourceId);
            if(previous.isPresent()) return assessments.get(scope,number(previous.get(),"id"),true);
            var definition=json.parse(source.get("definition_json"),AssessmentService.Definition.class);
            assessments.validate(definition);
            var imageIds=definition.questions().stream().map(AssessmentService.Question::imageId).filter(Objects::nonNull).distinct().toList();
            var copies=images.copyTestImages(scope,imageIds);
            var questions=definition.questions().stream().map(q->new AssessmentService.Question(q.type(),q.text(),q.difficulty(),q.points(),q.timeSeconds(),q.options(),q.acceptedAnswers(),q.caseInsensitive(),q.collapseWhitespace(),q.criteria(),q.explanation(),q.imageId()==null?null:copies.get(q.imageId()))).toList();
            var copy=new AssessmentService.Definition(definition.title(),definition.description(),definition.subject(),definition.level(),definition.instructions(),definition.language(),definition.gradingScale(),definition.passThreshold(),questions,definition.additionalInformation());
            long id=number(assessments.save(scope,null,copy),"id");
            assessments.publish(scope,id);
            repository.deleteImportLink(scope.organizationId(),scope.userId(),sourceId);
            repository.recordImport(scope.organizationId(),scope.userId(),sourceId,id);
            audit.write(scope.organizationId(),scope.userId(),"assessment.imported_by_number",id,Map.of("source",sourceId,"version",number(source,"version_id")));
            return assessments.get(scope,id,true);
        });
    }
    private WorkspaceError unavailable() {return WorkspaceError.validation("Няма достъпен запазен тест с този номер.");}
}
