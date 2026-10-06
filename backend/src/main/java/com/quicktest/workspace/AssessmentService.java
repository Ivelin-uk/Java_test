package com.quicktest.workspace;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.time.Clock;
import java.util.*;
import static com.quicktest.workspace.WorkspaceStore.*;

@Service
public class AssessmentService {
    private final WorkspaceStore db;
    private final WorkspaceAudit audit;
    private final Clock clock;
    private final PrivateImageService images;
    public AssessmentService(WorkspaceStore db,WorkspaceAudit audit,Clock clock,PrivateImageService images) {this.db=db;this.audit=audit;this.clock=clock;this.images=images;}
    public List<Map<String,Object>> list(OrgAccess.Scope scope) {
        return db.rows("SELECT id,title,status,shared,owner_id,updated_at FROM workspace_assessments WHERE organization_id=? AND (owner_id=? OR shared=TRUE) ORDER BY updated_at DESC",scope.organizationId(),scope.userId());
    }
    public Map<String,Object> get(OrgAccess.Scope scope,long id,boolean edit) {
        var row=db.one("SELECT * FROM workspace_assessments WHERE organization_id=? AND id=?",scope.organizationId(),id);
        if(number(row,"owner_id")!=scope.userId() && (edit || !flag(row,"shared"))) throw WorkspaceError.forbidden();
        return row;
    }
    @Transactional
    public Map<String,Object> save(OrgAccess.Scope scope,Long id,Definition definition) {
        if(definition==null || definition.title()==null || definition.title().isBlank() || definition.title().length()>190 || definition.questions()==null || definition.questions().size()>100) throw WorkspaceError.validation("Заглавие до 190 символа и до 100 въпроса.");
        for(var question:definition.questions()) if(question!=null) images.validateQuestionImage(scope,question.imageId());
        if(id==null) id=db.insert("INSERT INTO workspace_assessments(organization_id,owner_id,title,definition_json,updated_at) VALUES(?,?,?,?,?)",scope.organizationId(),scope.userId(),definition.title(),db.json(definition),clock.instant());
        else {
            get(scope,id,true);
            db.update("UPDATE workspace_assessments SET title=?,definition_json=?,status='draft',updated_at=? WHERE organization_id=? AND id=?",definition.title(),db.json(definition),clock.instant(),scope.organizationId(),id);
        }
        audit.write(scope.organizationId(),scope.userId(),"assessment.saved",id,Map.of());
        return get(scope,id,true);
    }
    @Transactional
    public Map<String,Object> publish(OrgAccess.Scope scope,long id) {
        db.one("SELECT id FROM workspace_assessments WHERE organization_id=? AND id=? FOR UPDATE",scope.organizationId(),id);
        var row=get(scope,id,true); Definition definition=db.parse(row.get("definition_json"),Definition.class);validate(definition);
        for(var question:definition.questions()) images.validateQuestionImage(scope,question.imageId());
        int next=(int)db.count("SELECT COALESCE(MAX(version_number),0)+1 FROM assessment_versions WHERE organization_id=? AND assessment_id=?",scope.organizationId(),id);
        long version=db.insert("INSERT INTO assessment_versions(organization_id,assessment_id,version_number,title,definition_json,published_at) VALUES(?,?,?,?,?,?)",scope.organizationId(),id,next,definition.title(),db.json(definition),clock.instant());
        db.update("UPDATE workspace_assessments SET status='published' WHERE organization_id=? AND id=?",scope.organizationId(),id);
        audit.write(scope.organizationId(),scope.userId(),"assessment.published",id,Map.of("version",version,"number",next));
        return db.one("SELECT id,assessment_id,version_number,title,published_at FROM assessment_versions WHERE organization_id=? AND id=?",scope.organizationId(),version);
    }
    public List<Map<String,Object>> versions(OrgAccess.Scope scope,long id) {
        get(scope,id,false);
        return db.rows("SELECT id,version_number,title,published_at FROM assessment_versions WHERE organization_id=? AND assessment_id=? ORDER BY version_number DESC",scope.organizationId(),id);
    }
    @Transactional
    public Map<String,Object> duplicate(OrgAccess.Scope scope,long id) {
        Definition old=db.parse(get(scope,id,false).get("definition_json"),Definition.class);
        return save(scope,null,new Definition(old.title()+" (копие)",old.description(),old.subject(),old.level(),old.instructions(),old.language(),old.gradingScale(),old.passThreshold(),old.questions()));
    }
    @Transactional
    public void archive(OrgAccess.Scope scope,long id) {
        get(scope,id,true);
        if(db.count("SELECT COUNT(*) FROM assessment_versions WHERE organization_id=? AND assessment_id=?",scope.organizationId(),id)==0) db.update("DELETE FROM workspace_assessments WHERE organization_id=? AND id=?",scope.organizationId(),id);
        else db.update("UPDATE workspace_assessments SET status='archived' WHERE organization_id=? AND id=?",scope.organizationId(),id);
        audit.write(scope.organizationId(),scope.userId(),"assessment.removed_or_archived",id,Map.of());
    }
    @Transactional
    public void share(OrgAccess.Scope scope,long id,boolean shared) {
        get(scope,id,true);
        db.update("UPDATE workspace_assessments SET shared=? WHERE organization_id=? AND id=?",shared,scope.organizationId(),id);
        audit.write(scope.organizationId(),scope.userId(),"assessment.sharing_changed",id,Map.of("shared",shared));
    }
    public void validate(Definition definition) {
        if(definition==null || definition.title()==null || definition.title().isBlank() || definition.title().length()>190 || definition.questions()==null || definition.questions().isEmpty() || definition.questions().size()>100) throw WorkspaceError.validation("Тестът трябва да има заглавие и 1–100 въпроса.");
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
    public record Definition(String title,String description,String subject,String level,String instructions,String language,String gradingScale,BigDecimal passThreshold,List<Question> questions) {}
    public record Question(String type,String text,String difficulty,BigDecimal points,int timeSeconds,List<Option> options,List<String> acceptedAnswers,boolean caseInsensitive,boolean collapseWhitespace,String criteria,String explanation,Long imageId) {
        public Question(String type,String text,String difficulty,BigDecimal points,int timeSeconds,List<Option> options,List<String> acceptedAnswers,boolean caseInsensitive,boolean collapseWhitespace,String criteria,String explanation) {this(type,text,difficulty,points,timeSeconds,options,acceptedAnswers,caseInsensitive,collapseWhitespace,criteria,explanation,null);}
    }
    public record Option(String text,boolean correct) {}
}
