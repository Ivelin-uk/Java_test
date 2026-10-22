package com.quicktest.workspace;

import com.quicktest.workspace.repository.AssessmentRepository;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.time.Clock;
import java.util.*;
import static com.quicktest.workspace.WorkspaceValues.*;

@Service
public class AssessmentService {
    private final WorkspaceJson json;
    private final AssessmentRepository repository;
    private final WorkspaceAudit audit;
    private final Clock clock;
    private final PrivateImageService images;
    private final PersonalWorkspace personal;
    private final WorkspaceCrypto crypto;
    public AssessmentService(AssessmentRepository repository,WorkspaceJson json,WorkspaceAudit audit,Clock clock,PrivateImageService images,PersonalWorkspace personal,WorkspaceCrypto crypto) {this.repository=repository;this.json=json;this.audit=audit;this.clock=clock;this.images=images;this.personal=personal;this.crypto=crypto;}
    public List<Map<String,Object>> list(OrgAccess.Scope scope) {
        return repository.findVisibleTests(scope.organizationId(), scope.platform(), scope.userId(), scope.userId()).stream().map(row -> {
            Definition definition=json.parse(row.remove("definition_json"),Definition.class);
            row.put("question_count",definition.questions().size());
            row.put("total_time_seconds",definition.questions().stream().mapToInt(Question::timeSeconds).sum());
            return row;
        }).toList();
    }
    public Map<String,Object> get(OrgAccess.Scope scope,long id,boolean edit) {
        var row=repository.requireTest(scope.organizationId(), id);
        if(number(row,"owner_id")!=scope.userId() && (edit || !flag(row,"shared"))) throw WorkspaceError.forbidden();
        return row;
    }
    @Transactional
    public Map<String,Object> save(OrgAccess.Scope scope,Long id,Definition definition) {
        if(definition==null || definition.title()==null || definition.title().isBlank() || definition.title().length()>190 || definition.questions()==null || definition.questions().size()>100) throw WorkspaceError.validation("Заглавие до 190 символа и до 100 въпроса.");
        validateAdditionalInformation(definition);
        for(var question:definition.questions()) if(question!=null) images.validateQuestionImage(scope,question.imageId());
        if(id==null) {
            if(scope.platform()) personal.member(scope.organizationId(),scope.userId(),"TEACHER");
            String number;do {number=crypto.assessmentNumber();} while(repository.assessmentNumberExists(number));
            id=repository.insertTest(scope.organizationId(), scope.userId(), definition.title(), json.write(definition), number,clock.instant());
        }
        else {
            get(scope,id,true);
            repository.updateDraft(definition.title(), json.write(definition), clock.instant(), scope.organizationId(), id);
        }
        audit.write(scope.organizationId(),scope.userId(),"assessment.saved",id,Map.of());
        return get(scope,id,true);
    }
    @Transactional
    public Map<String,Object> publish(OrgAccess.Scope scope,long id) {
        repository.lockTest(scope.organizationId(), id);
        var row=get(scope,id,true); Definition definition=json.parse(row.get("definition_json"),Definition.class);validate(definition);
        for(var question:definition.questions()) images.validateQuestionImage(scope,question.imageId());
        int next=(int)repository.nextVersionNumber(scope.organizationId(), id);
        long version=repository.insertVersion(scope.organizationId(), id, next, definition.title(), json.write(definition), clock.instant());
        repository.markPublished(scope.organizationId(), id);
        audit.write(scope.organizationId(),scope.userId(),"assessment.published",id,Map.of("version",version,"number",next));
        return repository.requireVersion(scope.organizationId(), version);
    }
    public List<Map<String,Object>> versions(OrgAccess.Scope scope,long id) {
        get(scope,id,false);
        return repository.findVersions(scope.organizationId(), id);
    }
    @Transactional
    public Map<String,Object> duplicate(OrgAccess.Scope scope,long id) {
        Definition old=json.parse(get(scope,id,false).get("definition_json"),Definition.class);
        return save(scope,null,new Definition(old.title()+" (копие)",old.description(),old.subject(),old.level(),old.instructions(),old.language(),old.gradingScale(),old.passThreshold(),old.questions(),old.additionalInformation()));
    }
    @Transactional
    public void archive(OrgAccess.Scope scope,long id) {
        var row=get(scope,id,false);
        if(number(row,"owner_id")!=scope.userId()) {
            repository.removeFromLibrary(scope.organizationId(), id, scope.userId(), clock.instant());
            audit.write(scope.organizationId(),scope.userId(),"assessment.removed_from_library",id,Map.of());
            return;
        }
        if(repository.countVersions(scope.organizationId(), id)==0) repository.deleteTest(scope.organizationId(), id);
        else repository.archiveTest(scope.organizationId(), id);
        audit.write(scope.organizationId(),scope.userId(),"assessment.removed_or_archived",id,Map.of());
    }
    @Transactional
    public void share(OrgAccess.Scope scope,long id,boolean shared) {
        get(scope,id,true);
        repository.updateSharing(shared, scope.organizationId(), id);
        audit.write(scope.organizationId(),scope.userId(),"assessment.sharing_changed",id,Map.of("shared",shared));
    }
    public void validate(Definition definition) {
        if(definition==null || definition.title()==null || definition.title().isBlank() || definition.title().length()>190 || definition.questions()==null || definition.questions().isEmpty() || definition.questions().size()>100) throw WorkspaceError.validation("Тестът трябва да има заглавие и 1–100 въпроса.");
        validateAdditionalInformation(definition);
        if(!Set.of("bulgarian","percentage","pass_fail").contains(Objects.toString(definition.gradingScale(),"")) || definition.passThreshold()==null || definition.passThreshold().compareTo(BigDecimal.ZERO)<0 || definition.passThreshold().compareTo(new BigDecimal("100"))>0) throw WorkspaceError.validation("Невалидна скала или праг.");
        for(Question question:definition.questions()) validateQuestion(question);
    }
    public void validateQuestion(Question q) {
        if(q==null || q.text()==null || q.text().isBlank() || q.text().length()>12000 || !Set.of("SINGLE_CHOICE","MULTIPLE_CHOICE","TRUE_FALSE","SHORT_ANSWER","OPEN_ANSWER").contains(Objects.toString(q.type(),"")) || !Set.of("EASY","MEDIUM","HARD","VERY_HARD").contains(Objects.toString(q.difficulty(),"")) || q.points()==null || q.points().compareTo(BigDecimal.ZERO)<=0 || q.points().compareTo(new BigDecimal("10000"))>0 || q.points().scale()>4 || q.timeSeconds()<10 || q.timeSeconds()>3600) throw WorkspaceError.validation("Невалиден въпрос: текст, тип, трудност, точки или време (10–3600 s).");
        List<Option> options=q.options()==null?List.of():q.options();
        if(options.size()>30 || options.stream().anyMatch(o->o==null || o.text()==null || o.text().isBlank() || o.text().length()>4000) || options.stream().map(o->o.text().strip().toLowerCase(Locale.ROOT)).distinct().count()!=options.size()) throw WorkspaceError.validation("Празни или повтарящи се опции.");
        long correct=options.stream().filter(Option::correct).count();
        if(Set.of("SINGLE_CHOICE","TRUE_FALSE").contains(q.type()) && (options.size()<2 || correct!=1) || q.type().equals("TRUE_FALSE") && options.size()!=2 || q.type().equals("MULTIPLE_CHOICE") && (options.size()<2 || correct<1)) throw WorkspaceError.validation("Задайте правилния брой верни опции.");
        if(Set.of("SHORT_ANSWER","OPEN_ANSWER").contains(q.type()) && !options.isEmpty()) throw WorkspaceError.validation("Текстов въпрос не съдържа опции.");
        if(q.acceptedAnswers()!=null && (q.acceptedAnswers().size()>30 || q.acceptedAnswers().stream().anyMatch(a->a==null || a.isBlank() || a.length()>4000))) throw WorkspaceError.validation("Невалидни допустими отговори.");
        if(q.type().equals("OPEN_ANSWER") && (q.criteria()==null || q.criteria().isBlank())) throw WorkspaceError.validation("Свободният отговор изисква критерии за проверка.");
    }
    private void validateAdditionalInformation(Definition definition) {
        if(definition.additionalInformation()!=null && definition.additionalInformation().length()>20000) throw WorkspaceError.validation("Допълнителната информация трябва да е до 20 000 символа.");
    }
    public record Definition(String title,String description,String subject,String level,String instructions,String language,String gradingScale,BigDecimal passThreshold,List<Question> questions,String additionalInformation) {
        public Definition(String title,String description,String subject,String level,String instructions,String language,String gradingScale,BigDecimal passThreshold,List<Question> questions) {this(title,description,subject,level,instructions,language,gradingScale,passThreshold,questions,null);}
    }
    public record Question(String type,String text,String difficulty,BigDecimal points,int timeSeconds,List<Option> options,List<String> acceptedAnswers,boolean caseInsensitive,boolean collapseWhitespace,String criteria,String explanation,Long imageId) {
        public Question(String type,String text,String difficulty,BigDecimal points,int timeSeconds,List<Option> options,List<String> acceptedAnswers,boolean caseInsensitive,boolean collapseWhitespace,String criteria,String explanation) {this(type,text,difficulty,points,timeSeconds,options,acceptedAnswers,caseInsensitive,collapseWhitespace,criteria,explanation,null);}
    }
    public record Option(String text,boolean correct) {}
}
