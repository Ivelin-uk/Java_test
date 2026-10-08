package com.quicktest.workspace;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.text.Normalizer;
import java.time.Clock;
import java.util.*;
import static com.quicktest.workspace.WorkspaceStore.*;

@Service
public class AttemptService {
    private final WorkspaceStore db;private final Clock clock;private final WorkspaceCrypto crypto;
    private final OrganizationService organizations;private final AssignmentService assignments;
    private final NotificationService notifications;private final CodeRateLimiter limiter;
    private final TransactionTemplate transactions;private final PasswordEncoder passwords;
    private final WorkspaceAudit audit;private final boolean workers;private final ProfileExamMutex mutex;
    public AttemptService(WorkspaceStore db,Clock clock,WorkspaceCrypto crypto,OrganizationService organizations,AssignmentService assignments,NotificationService notifications,CodeRateLimiter limiter,TransactionTemplate transactions,PasswordEncoder passwords,WorkspaceAudit audit,ProfileExamMutex mutex,@Value("${app.workspace.workers:true}") boolean workers) {
        this.db=db;this.clock=clock;this.crypto=crypto;this.organizations=organizations;this.assignments=assignments;this.notifications=notifications;this.limiter=limiter;this.transactions=transactions;this.passwords=passwords;this.audit=audit;this.workers=workers;this.mutex=mutex;
    }
    public Map<String,Object> start(OrgAccess.Scope scope,long assignment,StartRequest request,String authSession,String ip) {
        requireKey(request.idempotencyKey());requireKey(request.browserId());
        if(request.sessionToken()==null || !request.sessionToken().matches("[A-Za-z0-9_-]{43,80}")) throw WorkspaceError.validation("Невалиден ключ на изпитната сесия.");
        // Rate accounting commits before the attempt transaction, including rejected guesses.
        // This also avoids exhausting the connection pool with nested transactions at exam start.
        if(db.count("SELECT COUNT(*) FROM exam_attempts WHERE organization_id=? AND assignment_id=? AND student_id=? AND start_key=?",scope.organizationId(),assignment,scope.userId(),request.idempotencyKey())==0) {
            db.one("SELECT student_id FROM assignment_recipients WHERE organization_id=? AND assignment_id=? AND student_id=? AND canceled=FALSE",scope.organizationId(),assignment,scope.userId());
            var code=db.one("SELECT code_hash FROM exam_assignments WHERE organization_id=? AND id=?",scope.organizationId(),assignment);
            boolean valid=request.code()!=null && code.get("code_hash")!=null && crypto.matches(scope.organizationId()+":"+assignment+":"+request.code().strip().toUpperCase(Locale.ROOT),string(code,"code_hash"));
            if(!limiter.check(scope.organizationId(),assignment,scope.userId(),ip,valid)) throw limiter.limited();
            if(!valid) throw WorkspaceError.validation("Невалиден или отменен код.");
        }
        return transactions.execute(tx-> {
            mutex.lock(scope.userId());
            var recipient=db.one("SELECT * FROM assignment_recipients WHERE organization_id=? AND assignment_id=? AND student_id=? FOR UPDATE",scope.organizationId(),assignment,scope.userId());
            var previous=db.optional("SELECT * FROM exam_attempts WHERE organization_id=? AND assignment_id=? AND student_id=? AND start_key=? FOR UPDATE",scope.organizationId(),assignment,scope.userId(),request.idempotencyKey());
            Session session=new Session(request.sessionToken(),request.browserId(),authSession);
            if(previous.isPresent()) {checkSession(previous.get(),session);sweep(previous.get());return state(previous.get());}
            if(flag(recipient,"canceled")) throw WorkspaceError.forbidden();
            notifications.verifiedAddress(scope.userId());if(!scope.platform()) organizations.requirePaid(scope.organizationId());
            var a=db.one("SELECT a.*,v.definition_json FROM exam_assignments a JOIN assessment_versions v ON v.organization_id=a.organization_id AND v.id=a.version_id WHERE a.organization_id=? AND a.id=?",scope.organizationId(),assignment);
            if(clock.instant().isBefore(time(a,"starts_at")) || !clock.instant().isBefore(time(a,"ends_at"))) throw WorkspaceError.expired("Тестът е извън разрешения период.");
            if(!flag(recipient,"fullscreen_exempt") && (!request.fullscreenSupported() || !request.fullscreenActive() || !request.visible())) throw WorkspaceError.conflict("Началото изисква поддържан цял екран и видима страница. Опит не е изразходван.");
            boolean correct=request.code()!=null && a.get("code_hash")!=null && crypto.matches(scope.organizationId()+":"+assignment+":"+request.code().strip().toUpperCase(Locale.ROOT),string(a,"code_hash"));
            if(!correct) throw WorkspaceError.validation("Невалиден или отменен код.");
            if(db.count("SELECT COUNT(*) FROM exam_attempts WHERE student_id=? AND status='in_progress'",scope.userId())>0) throw WorkspaceError.conflict("Има активен опит. Продължете съществуващата изпитна сесия.");
            long count=db.count("SELECT COUNT(*) FROM exam_attempts WHERE organization_id=? AND assignment_id=? AND student_id=?",scope.organizationId(),assignment,scope.userId());
            if(count>=number(recipient,"max_attempts")) throw WorkspaceError.conflict("Няма оставащи опити.");
            long id=db.insert("INSERT INTO exam_attempts(organization_id,assignment_id,student_id,attempt_number,start_key,session_hash,auth_session_hash,browser_id,active_key,started_at) VALUES(?,?,?,?,?,?,?,?,?,?)",scope.organizationId(),assignment,scope.userId(),count+1,request.idempotencyKey(),crypto.hash(request.sessionToken()),crypto.hash(authSession),request.browserId(),scope.organizationId()+":"+assignment+":"+scope.userId(),clock.instant());
            var definition=db.parse(a.get("definition_json"),AssessmentService.Definition.class);
            List<AssessmentService.Question> questions=new ArrayList<>(definition.questions());
            if(flag(a,"shuffle_questions")) Collections.shuffle(questions,new java.security.SecureRandom());
            for(int i=0;i<questions.size();i++) {
                var q=questions.get(i);List<Map<String,Object>> options=new ArrayList<>();
                for(var option:q.options()==null?List.<AssessmentService.Option>of():q.options()) options.add(Map.of("id",UUID.randomUUID().toString(),"text",option.text(),"correct",option.correct()));
                if(flag(a,"shuffle_options")) Collections.shuffle(options,new java.security.SecureRandom());
                db.insert("INSERT INTO attempt_questions(organization_id,attempt_id,position_index,definition_json,maximum_points,time_seconds) VALUES(?,?,?,?,?,?)",scope.organizationId(),id,i,db.json(Map.of("question",q,"options",options)),q.points(),(int)Math.ceil(q.timeSeconds()*decimal(recipient,"time_multiplier").doubleValue()));
            }
            var attempt=lock(scope.organizationId(),id);openInternal(attempt,request.fullscreenActive(),request.visible());
            audit.write(scope.organizationId(),scope.userId(),"attempt.started",id,Map.of("number",count+1));
            return state(attempt);
        });
    }
    public Map<String,Object> recipient(OrgAccess.Scope scope,long assignment) {return db.one("SELECT fullscreen_exempt FROM assignment_recipients WHERE organization_id=? AND assignment_id=? AND student_id=?",scope.organizationId(),assignment,scope.userId());}
    private Map<String,Object> lock(long org,long id) {return db.one("SELECT * FROM exam_attempts WHERE organization_id=? AND id=? FOR UPDATE",org,id);}
    private void checkSession(Map<String,Object> attempt,Session session) {
        if(session.token()==null || session.browserId()==null || session.authorization()==null || !crypto.matches(session.token(),string(attempt,"session_hash")) || !crypto.matches(session.authorization(),string(attempt,"auth_session_hash")) || !session.browserId().equals(string(attempt,"browser_id"))) throw WorkspaceError.conflict("Опитът е отворен в друга сесия. Използвайте защитено прехвърляне.");
    }
    private Map<String,Object> own(OrgAccess.Scope scope,long id,Session session) {
        var attempt=lock(scope.organizationId(),id);
        if(number(attempt,"student_id")!=scope.userId()) throw WorkspaceError.forbidden();
        checkSession(attempt,session);sweep(attempt);return attempt;
    }
    @Transactional
    public Map<String,Object> getState(OrgAccess.Scope scope,long id,Session session) {return state(own(scope,id,session));}
    @Transactional
    public Map<String,Object> open(OrgAccess.Scope scope,long id,Session session,Ready ready) {
        var attempt=own(scope,id,session);openInternal(attempt,ready.fullscreenActive(),ready.visible());return state(attempt);
    }
    private void openInternal(Map<String,Object> attempt,boolean fullscreen,boolean visible) {
        if(!string(attempt,"status").equals("in_progress")) return;
        var q=current(attempt);
        if(!string(q,"status").equals("pending")) return;
        var recipient=db.one("SELECT fullscreen_exempt FROM assignment_recipients WHERE organization_id=? AND assignment_id=? AND student_id=?",number(attempt,"organization_id"),number(attempt,"assignment_id"),number(attempt,"student_id"));
        if(!visible || !flag(recipient,"fullscreen_exempt") && !fullscreen) throw WorkspaceError.conflict("Продължете на видим цял екран.");
        var assignment=db.one("SELECT ends_at FROM exam_assignments WHERE organization_id=? AND id=?",number(attempt,"organization_id"),number(attempt,"assignment_id"));
        var deadline=clock.instant().plusSeconds(number(q,"time_seconds"));
        if(deadline.isAfter(time(assignment,"ends_at"))) deadline=time(assignment,"ends_at");
        db.update("UPDATE attempt_questions SET status='open',open_instance=?,opened_at=?,deadline_at=? WHERE organization_id=? AND id=?",UUID.randomUUID().toString(),clock.instant(),deadline,number(attempt,"organization_id"),number(q,"id"));
    }
    private Map<String,Object> current(Map<String,Object> attempt) {
        return db.one("SELECT * FROM attempt_questions WHERE organization_id=? AND attempt_id=? AND position_index=?",number(attempt,"organization_id"),number(attempt,"id"),number(attempt,"current_position"));
    }
    @Transactional
    public Map<String,Object> draft(OrgAccess.Scope scope,long id,long question,Session session,AnswerRequest request) {
        var attempt=own(scope,id,session);
        if(!string(attempt,"status").equals("in_progress")) return state(attempt);
        var q=current(attempt);if(!matches(q,question,request.openInstance())) return state(attempt);
        validateAnswer(q,request.answer());
        db.update("UPDATE attempt_questions SET draft_json=? WHERE organization_id=? AND id=?",db.json(request.answer()),scope.organizationId(),question);
        return state(attempt);
    }
    @Transactional
    public Map<String,Object> answer(OrgAccess.Scope scope,long id,long question,Session session,AnswerRequest request) {
        requireKey(request.idempotencyKey());var attempt=own(scope,id,session);
        if(!string(attempt,"status").equals("in_progress")) return state(attempt);
        var q=current(attempt);if(!matches(q,question,request.openInstance())) return state(attempt);
        validateAnswer(q,request.answer());
        BigDecimal points=score(q,request.answer());
        db.update("UPDATE attempt_questions SET status='answered',closed_at=?,answer_json=?,answer_key=?,automatic_points=?,final_points=?,reviewed=? WHERE organization_id=? AND id=?",clock.instant(),db.json(request.answer()),request.idempotencyKey(),points,points,points!=null,scope.organizationId(),question);
        advance(attempt);return state(attempt);
    }
    private boolean matches(Map<String,Object> q,long id,String instance) {
        return number(q,"id")==id && string(q,"status").equals("open") && string(q,"open_instance").equals(instance);
    }
    private void validateAnswer(Map<String,Object> q,Answer answer) {
        if(answer==null || answer.optionIds()==null || answer.optionIds().size()>30 || answer.text()==null || answer.text().length()>30000) throw WorkspaceError.validation("Невалиден отговор.");
        var snapshot=db.object(q.get("definition_json"));var definition=db.object(db.json(snapshot.get("question")));
        List<Map<String,Object>> options=options(snapshot);Set<String> allowed=new HashSet<>();options.forEach(o->allowed.add(string(o,"id")));
        if(!allowed.containsAll(answer.optionIds()) || new HashSet<>(answer.optionIds()).size()!=answer.optionIds().size()) throw WorkspaceError.validation("Невалидни избрани опции.");
        if(!string(definition,"type").equals("MULTIPLE_CHOICE") && answer.optionIds().size()>1) throw WorkspaceError.validation("Изберете най-много един отговор.");
    }
    @SuppressWarnings("unchecked")
    private List<Map<String,Object>> options(Map<String,Object> snapshot) {return (List<Map<String,Object>>)snapshot.get("options");}
    private BigDecimal score(Map<String,Object> row,Answer answer) {
        var snapshot=db.object(row.get("definition_json"));var question=db.parse(db.json(snapshot.get("question")),AssessmentService.Question.class);
        if(question.type().equals("OPEN_ANSWER") || question.type().equals("SHORT_ANSWER") && (question.acceptedAnswers()==null || question.acceptedAnswers().isEmpty())) return null;
        boolean correct;
        if(question.type().equals("SHORT_ANSWER")) correct=question.acceptedAnswers().stream().map(text->normalize(text,question)).anyMatch(text->text.equals(normalize(answer.text(),question)));
        else {
            Set<String> expected=new HashSet<>();options(snapshot).stream().filter(o->flag(o,"correct")).forEach(o->expected.add(string(o,"id")));
            correct=expected.equals(new HashSet<>(answer.optionIds()));
        }
        return correct?decimal(row,"maximum_points"):BigDecimal.ZERO;
    }
    private String normalize(String value,AssessmentService.Question q) {
        String text=Normalizer.normalize(value,Normalizer.Form.NFC).strip();
        if(q.collapseWhitespace()) text=text.replaceAll("\\s+"," ");
        return q.caseInsensitive()?text.toLowerCase(Locale.ROOT):text;
    }
    private void closeZero(Map<String,Object> q,String status) {
        db.update("UPDATE attempt_questions SET status=?,closed_at=?,automatic_points=0,final_points=0,reviewed=TRUE WHERE organization_id=? AND id=? AND status IN ('pending','open')",status,clock.instant(),number(q,"organization_id"),number(q,"id"));
    }
    private void advance(Map<String,Object> attempt) {
        long next=number(attempt,"current_position")+1;
        db.update("UPDATE exam_attempts SET current_position=? WHERE organization_id=? AND id=?",next,number(attempt,"organization_id"),number(attempt,"id"));attempt.put("current_position",next);
        long total=db.count("SELECT COUNT(*) FROM attempt_questions WHERE organization_id=? AND attempt_id=?",number(attempt,"organization_id"),number(attempt,"id"));
        if(next>=total) finish(attempt,false);
    }
    private void finish(Map<String,Object> attempt,boolean expired) {
        db.update("UPDATE exam_attempts SET status='pending_review',active_key=NULL,submitted_at=?,expired=? WHERE organization_id=? AND id=? AND status='in_progress'",clock.instant(),expired,number(attempt,"organization_id"),number(attempt,"id"));
        attempt.put("status","pending_review");attempt.put("submitted_at",clock.instant().toString());attempt.put("expired",expired);
    }
    private void sweep(Map<String,Object> attempt) {
        if(!string(attempt,"status").equals("in_progress")) return;
        var assignment=db.one("SELECT ends_at FROM exam_assignments WHERE organization_id=? AND id=?",number(attempt,"organization_id"),number(attempt,"assignment_id"));
        if(!clock.instant().isBefore(time(assignment,"ends_at"))) {
            for(var q:db.rows("SELECT * FROM attempt_questions WHERE organization_id=? AND attempt_id=? AND status IN ('pending','open')",number(attempt,"organization_id"),number(attempt,"id"))) closeZero(q,string(q,"status").equals("open")?"timed_out":"unanswered");
            finish(attempt,true);return;
        }
        var q=current(attempt);
        if(string(q,"status").equals("open") && !clock.instant().isBefore(time(q,"deadline_at"))) {closeZero(q,"timed_out");advance(attempt);}
    }
    @Transactional
    public Map<String,Object> event(OrgAccess.Scope scope,long id,Session session,Event request) {
        requireKey(request.eventKey());
        if(!Set.of("fullscreen_exit","visibility_hidden","blur","refresh","offline","online").contains(request.type())) throw WorkspaceError.validation("Невалидно събитие.");
        var attempt=own(scope,id,session);
        if(db.count("SELECT COUNT(*) FROM exam_events WHERE organization_id=? AND attempt_id=? AND event_key=?",scope.organizationId(),id,request.eventKey())>0) return state(attempt);
        if(request.questionId()!=null && db.count("SELECT COUNT(*) FROM attempt_questions WHERE organization_id=? AND attempt_id=? AND id=?",scope.organizationId(),id,request.questionId())==0) throw WorkspaceError.forbidden();
        db.insert("INSERT INTO exam_events(organization_id,attempt_id,question_id,open_instance,event_key,event_type,telemetry_json,received_at) VALUES(?,?,?,?,?,?,?,?)",scope.organizationId(),id,request.questionId(),request.openInstance(),request.eventKey(),request.type(),db.json(Map.of("visible",request.visible(),"fullscreen",request.fullscreen())),clock.instant());
        if(string(attempt,"status").equals("in_progress") && request.questionId()!=null && Set.of("fullscreen_exit","visibility_hidden").contains(request.type())) {
            var q=current(attempt);
            var recipient=db.one("SELECT fullscreen_exempt FROM assignment_recipients WHERE organization_id=? AND assignment_id=? AND student_id=?",scope.organizationId(),number(attempt,"assignment_id"),scope.userId());
            if(matches(q,request.questionId(),request.openInstance()) && (!request.type().equals("fullscreen_exit") || !flag(recipient,"fullscreen_exempt"))) {closeZero(q,"invalidated");advance(attempt);}
        }
        return state(attempt);
    }
    @Transactional
    public Map<String,Object> submit(OrgAccess.Scope scope,long id,Session session) {
        var attempt=own(scope,id,session);
        if(string(attempt,"status").equals("in_progress")) {
            for(var q:db.rows("SELECT * FROM attempt_questions WHERE organization_id=? AND attempt_id=? AND status IN ('pending','open')",scope.organizationId(),id)) closeZero(q,"unanswered");
            finish(attempt,false);
        }
        return state(attempt);
    }
    @Transactional
    public Map<String,Object> transfer(OrgAccess.Scope scope,long id,StartRequest request,String password,String authSession) {
        requireKey(request.browserId());
        if(request.sessionToken()==null || !request.sessionToken().matches("[A-Za-z0-9_-]{43,80}")) throw WorkspaceError.validation("Невалиден ключ на сесия.");
        var user=db.one("SELECT password_hash FROM users WHERE id=?",scope.userId());
        if(password==null || !passwords.matches(password,string(user,"password_hash"))) throw WorkspaceError.forbidden();
        var attempt=lock(scope.organizationId(),id);if(number(attempt,"student_id")!=scope.userId()) throw WorkspaceError.forbidden();
        sweep(attempt);
        db.update("UPDATE exam_attempts SET session_hash=?,auth_session_hash=?,browser_id=? WHERE organization_id=? AND id=?",crypto.hash(request.sessionToken()),crypto.hash(authSession),request.browserId(),scope.organizationId(),id);
        audit.write(scope.organizationId(),scope.userId(),"attempt.session_transferred",id,Map.of());return state(attempt);
    }
    private Map<String,Object> state(Map<String,Object> attempt) {
        Map<String,Object> result=new LinkedHashMap<>();
        for(String key:List.of("id","assignment_id","attempt_number","status","started_at","submitted_at","expired")) result.put(key,attempt.get(key));
        result.put("server_now",clock.instant().toString());
        long total=db.count("SELECT COUNT(*) FROM attempt_questions WHERE organization_id=? AND attempt_id=?",number(attempt,"organization_id"),number(attempt,"id"));
        result.put("question_count",total);result.put("question_number",Math.min(number(attempt,"current_position")+1,total));
        if(string(attempt,"status").equals("in_progress")) {
            var q=current(attempt);var snapshot=db.object(q.get("definition_json"));var question=db.parse(db.json(snapshot.get("question")),AssessmentService.Question.class);
            Map<String,Object> safe=new LinkedHashMap<>();
            for(String key:List.of("id","status","maximum_points","time_seconds","open_instance","opened_at","deadline_at")) safe.put(key,q.get(key));
            if(string(q,"status").equals("open")) {
                if(question.imageId()!=null) safe.put("imageId",question.imageId());safe.put("type",question.type());safe.put("text",question.text());safe.put("options",options(snapshot).stream().map(o->Map.of("id",string(o,"id"),"text",string(o,"text"))).toList());
            }
            safe.put("draft",q.get("draft_json")==null?null:db.object(q.get("draft_json")));result.put("question",safe);
        } else result.put("question",null);
        return result;
    }
    public List<Map<String,Object>> mine(OrgAccess.Scope scope) {
        return db.rows("SELECT a.id,a.assignment_id,a.attempt_number,a.status,a.started_at,a.submitted_at,a.expired,v.title FROM exam_attempts a JOIN exam_assignments s ON s.organization_id=a.organization_id AND s.id=a.assignment_id JOIN assessment_versions v ON v.organization_id=s.organization_id AND v.id=s.version_id WHERE (a.organization_id=? OR ?) AND a.student_id=? ORDER BY a.id DESC",scope.organizationId(),scope.platform(),scope.userId());
    }
    @Scheduled(fixedDelay=1000)
    public void expireDue() {
        if(!workers) return;
        var due=db.rows("SELECT DISTINCT a.organization_id,a.id FROM exam_attempts a JOIN exam_assignments s ON s.organization_id=a.organization_id AND s.id=a.assignment_id LEFT JOIN attempt_questions q ON q.organization_id=a.organization_id AND q.attempt_id=a.id AND q.status='open' WHERE a.status='in_progress' AND (s.ends_at<=? OR q.deadline_at<=?) LIMIT 500",clock.instant(),clock.instant());
        for(var row:due) transactions.executeWithoutResult(tx->sweep(lock(number(row,"organization_id"),number(row,"id"))));
    }
    private void requireKey(String key) {if(key==null || !key.matches("[A-Za-z0-9_-]{8,80}")) throw WorkspaceError.validation("Невалиден ключ за идемпотентност/сесия.");}
    public record Session(String token,String browserId,String authorization) {}
    public record StartRequest(String code,String idempotencyKey,String browserId,String sessionToken,boolean fullscreenSupported,boolean fullscreenActive,boolean visible) {}
    public record Ready(boolean fullscreenActive,boolean visible) {}
    public record Answer(List<String> optionIds,String text) {}
    public record AnswerRequest(String idempotencyKey,String openInstance,Answer answer) {}
    public record Event(String eventKey,Long questionId,String openInstance,String type,boolean visible,boolean fullscreen) {}
}
