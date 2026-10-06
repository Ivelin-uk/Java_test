package com.quicktest.workspace;

import com.quicktest.auth.*;
import com.quicktest.tests.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.util.*;
import static com.quicktest.workspace.WorkspaceStore.*;

@Component
@Order(200)
public class WorkspaceDemo implements CommandLineRunner {
    private final WorkspaceStore db;private final AppUserRepository users;private final PasswordEncoder passwords;
    private final OrganizationService organizations;private final AssessmentService assessments;
    private final AssignmentService assignments;private final QuizTestRepository legacyTests;
    private final QuizService legacy;private final IdentityWorkflow identity;private final Clock clock;private final boolean seed;
    public WorkspaceDemo(WorkspaceStore db,AppUserRepository users,PasswordEncoder passwords,OrganizationService organizations,AssessmentService assessments,AssignmentService assignments,QuizTestRepository legacyTests,QuizService legacy,IdentityWorkflow identity,Clock clock,@Value("${app.workspace.demo-seed:${app.demo-seed:false}}") boolean seed) {
        this.db=db;this.users=users;this.passwords=passwords;this.organizations=organizations;this.assessments=assessments;this.assignments=assignments;this.legacyTests=legacyTests;this.legacy=legacy;this.identity=identity;this.clock=clock;this.seed=seed;
    }
    @Override @Transactional
    public void run(String... args) {
        for(Object[] plan:List.of(new Object[]{"Starter",19,190,5,100,50,1_000_000_000L},new Object[]{"School",69,690,30,1000,300,10_000_000_000L},new Object[]{"University",199,1990,200,10000,2000,100_000_000_000L})) if(db.count("SELECT COUNT(*) FROM organization_plans WHERE name=?",plan[0])==0) db.insert("INSERT INTO organization_plans(name,monthly_eur,yearly_eur,teacher_limit,student_limit,ai_limit,storage_bytes) VALUES(?,?,?,?,?,?,?)",plan);
        if(!seed || db.count("SELECT COUNT(*) FROM demo_seed_history WHERE seed_key='examai-workspaces-v1'")>0) return;
        AppUser orgAdmin=user("orgadmin@examai.local","Организационен администратор",Role.TEACHER);
        AppUser teacher=user("teacher@quicktest.local","Демо учител",Role.TEACHER);
        AppUser student=user("student@quicktest.local","Демо ученик",Role.STUDENT);
        AppUser secondTeacher=user("teacher2@examai.local","Преподавател в Университет Б",Role.TEACHER);
        AppUser secondStudent=user("student2@examai.local","Студент в Университет Б",Role.STUDENT);
        long first=number(organizations.create(orgAdmin.getId(),new OrganizationService.OrganizationRequest("Училище А","school","office@school-a.example.test","Europe/Sofia","Ученик")),"id");
        long second=number(organizations.create(secondTeacher.getId(),new OrganizationService.OrganizationRequest("Университет Б","university","office@university-b.example.test","Europe/Sofia","Студент")),"id");
        member(first,teacher,"TEACHER");member(first,student,"STUDENT");member(second,secondStudent,"STUDENT");
        users.findByEmailIgnoreCase("demo@quicktest.local").ifPresent(user->member(first,user,"TEACHER"));
        for(var user:users.findAll()) identity.initialize(user);
        for(var test:legacyTests.findAll()) {
            long owner=test.getOwner().getId();
            if(db.count("SELECT COUNT(*) FROM memberships WHERE organization_id=? AND user_id=?",first,owner)==0) continue;
            var detail=legacy.get(users.findById(owner).orElseThrow(),test.getId());
            var scope=new OrgAccess.Scope(first,owner,Set.of("TEACHER"));
            var saved=assessments.save(scope,null,convert(detail));
            if(test.getStatus()==TestStatus.PUBLISHED) assessments.publish(scope,number(saved,"id"));
        }
        demoGroup(first,teacher,student,"12А – Софтуерно инженерство","EXAM2345");
        demoGroup(second,secondTeacher,secondStudent,"1 курс – Програмиране","UNIV2345");
        db.update("INSERT INTO demo_seed_history(seed_key,created_at) VALUES('examai-workspaces-v1',?)",clock.instant());
    }
    private AppUser user(String email,String name,Role role) {
        return users.findByEmailIgnoreCase(email).orElseGet(()-> {
            var user=new AppUser();user.setEmail(email);user.setName(name);user.setRole(role);user.setPasswordHash(passwords.encode("password123"));user.setEmailVerifiedAt(clock.instant());return users.saveAndFlush(user);
        });
    }
    private void member(long org,AppUser user,String role) {
        db.insert("INSERT INTO memberships(organization_id,user_id,roles_json,created_at) VALUES(?,?,?,?)",org,user.getId(),db.json(List.of(role)),clock.instant());
    }
    private void demoGroup(long org,AppUser teacher,AppUser student,String name,String code) {
        var scope=new OrgAccess.Scope(org,teacher.getId(),Set.of("TEACHER"));
        var group=organizations.createGroup(scope,new OrganizationService.GroupRequest(name,"Демонстрационна група","Програмиране","2026/2027","12 / 1"));
        organizations.addStudent(scope,number(group,"id"),student.getId());
        var definition=new AssessmentService.Definition("Основи на Java","Демонстрационен тест","Програмиране","Начално ниво","Решете въпросите последователно. Напускането на активния изпитен екран носи 0 точки за текущия въпрос.","bg","bulgarian",new BigDecimal("50"),List.of(new AssessmentService.Question("SINGLE_CHOICE","Кой тип съхранява логическа стойност в Java?","EASY",new BigDecimal("2"),30,List.of(new AssessmentService.Option("boolean",true),new AssessmentService.Option("String",false)),List.of(),true,true,"","boolean има стойности true и false."),new AssessmentService.Question("OPEN_ANSWER","Обяснете разликата между клас и обект.","MEDIUM",new BigDecimal("3"),120,List.of(),List.of(),true,true,"Класът е описание; обектът е конкретна инстанция.","")));
        var test=assessments.save(scope,null,definition);var version=assessments.publish(scope,number(test,"id"));
        var assignment=assignments.create(scope,new AssignmentService.AssignmentRequest(number(version,"id"),List.of(number(group,"id")),List.of(student.getId()),clock.instant().minusSeconds(60),clock.instant().plus(Duration.ofDays(30)),2,false,false,true));
        long id=number(assignment,"id");db.update("UPDATE exam_assignments SET code_hash=? WHERE organization_id=? AND id=?",assignments.codeHash(org,id,code),org,id);
    }
    public static AssessmentService.Definition convert(QuizDtos.TestDetail test) {
        return new AssessmentService.Definition(test.title(),Objects.toString(test.description(),""),"","","",test.language(),"bulgarian",new BigDecimal("50"),test.questions().stream().map(q->{
            boolean text=Set.of(QuestionType.SHORT_ANSWER,QuestionType.OPEN_ANSWER).contains(q.type());
            List<AssessmentService.Option> options=text?List.of():q.answers().stream().map(a->new AssessmentService.Option(a.answer(),a.correct())).toList();
            List<String> accepted=q.type()==QuestionType.SHORT_ANSWER?q.answers().stream().filter(QuizDtos.AnswerResponse::correct).map(QuizDtos.AnswerResponse::answer).toList():List.of();
            return new AssessmentService.Question(q.type().name(),q.question(),q.difficulty()==Difficulty.MIXED?"MEDIUM":q.difficulty().name(),BigDecimal.valueOf(q.points()),60,options,accepted,true,true,q.type()==QuestionType.OPEN_ANSWER?"Прегледайте обосноваността и коректността на отговора.":"",Objects.toString(q.explanation(),""));
        }).toList());
    }
}
