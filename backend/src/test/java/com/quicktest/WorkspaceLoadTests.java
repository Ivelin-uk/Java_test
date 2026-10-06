package com.quicktest;

import com.quicktest.auth.*;
import com.quicktest.workspace.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.*;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import static com.quicktest.workspace.WorkspaceStore.*;
import static org.junit.jupiter.api.Assertions.*;

@EnabledIfEnvironmentVariable(named="EXAMAI_LOAD_TEST",matches="true")
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"app.workspace.workers=false","app.legacy-api.enabled=false"})
class WorkspaceLoadTests {
    @DynamicPropertySource static void database(DynamicPropertyRegistry registry) {
        String url=Objects.requireNonNull(System.getenv("EXAMAI_TEST_DATABASE_URL"),"Use a dedicated MySQL verification database");
        if(!url.startsWith("jdbc:mysql:") || url.contains("/test_ai")) throw new IllegalArgumentException("Load verification requires an isolated MySQL database");
        registry.add("spring.datasource.url",()->url);registry.add("spring.datasource.username",()->System.getenv("EXAMAI_TEST_DATABASE_USERNAME"));registry.add("spring.datasource.password",()->System.getenv("EXAMAI_TEST_DATABASE_PASSWORD"));
    }
    @LocalServerPort int port;
    @Autowired WorkspaceStore db;
    @Autowired AppUserRepository users;
    @Autowired PasswordEncoder passwords;
    @Autowired OrganizationService organizations;
    @Autowired AssessmentService assessments;
    @Autowired AssignmentService assignments;
    @Autowired AttemptService attempts;
    @Autowired IdentityWorkflow identity;
    @Autowired WorkspaceCrypto crypto;

    @Test void twoHundredConcurrentHttpStateAndAnswerRequests() throws Exception {
        Instant now=Instant.now();String passwordHash=passwords.encode("fixture-password-123");
        var teacher=new AppUser();teacher.setName("Load fixture teacher");teacher.setEmail(UUID.randomUUID()+"@example.test");teacher.setPasswordHash(passwordHash);teacher.setEmailVerifiedAt(now);users.saveAndFlush(teacher);identity.initialize(teacher);
        long org=number(organizations.create(teacher.getId(),new OrganizationService.OrganizationRequest("Load fixture "+UUID.randomUUID(),"school",teacher.getEmail(),"Europe/Sofia","Ученик")),"id");
        long plan=number(db.one("SELECT id FROM organization_plans WHERE name='University'"),"id");db.update("UPDATE organization_subscriptions SET plan_id=? WHERE organization_id=?",plan,org);
        var teaching=new OrgAccess.Scope(org,teacher.getId(),Set.of("TEACHER","ORG_ADMIN"));List<Long> learners=new ArrayList<>();List<String> tokens=new ArrayList<>();
        for(int i=0;i<200;i++) {
            long user=db.insert("INSERT INTO users(name,email,password_hash,role,active,password_change_required,subscription_paid) VALUES(?,?,?,'STUDENT',TRUE,FALSE,FALSE)","Load fixture "+i,UUID.randomUUID()+"@example.test",passwordHash);
            learners.add(user);db.update("INSERT INTO notification_addresses(user_id,email,verified_at) VALUES(?,?,?)",user,"load-fixture-"+user+"@example.test",now);db.insert("INSERT INTO memberships(organization_id,user_id,roles_json,created_at) VALUES(?,?,'[\"STUDENT\"]',?)",org,user,now);
            String token=UUID.randomUUID().toString();tokens.add(token);db.update("INSERT INTO auth_token(token,user_id,created_at) VALUES(?,?,?)",token,user,now);
        }
        var definition=new AssessmentService.Definition("Load assessment","","","","","bg","bulgarian",new BigDecimal("50"),List.of(new AssessmentService.Question("SINGLE_CHOICE","Choose A","EASY",BigDecimal.ONE,3600,List.of(new AssessmentService.Option("A",true),new AssessmentService.Option("B",false)),List.of(),true,true,"","")));
        long test=number(assessments.save(teaching,null,definition),"id"),version=number(assessments.publish(teaching,test),"id");var assignment=assignments.create(teaching,new AssignmentService.AssignmentRequest(version,List.of(),learners,now.minusSeconds(1),now.plusSeconds(7200),1,false,false,true));long assignmentId=number(assignment,"id");String code=string(assignment,"code");
        List<Fixture> fixtures=new ArrayList<>();
        for(int i=0;i<200;i++) {
            var request=new AttemptService.StartRequest(code,UUID.randomUUID().toString(),UUID.randomUUID().toString(),crypto.token(),true,true,true);
            var state=attempts.start(new OrgAccess.Scope(org,learners.get(i),Set.of("STUDENT")),assignmentId,request,"Bearer "+tokens.get(i),"load-fixture-"+i);
            fixtures.add(new Fixture(tokens.get(i),request,number(state,"id"),db.object(db.json(state.get("question")))));
        }
        HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).version(HttpClient.Version.HTTP_1_1).build();
        List<Double> stateTimes=burst(http,org,fixtures,false);List<Double> answerTimes=burst(http,org,fixtures,true);
        burst(http,org,fixtures,true);
        assertEquals(200,db.count("SELECT COUNT(*) FROM exam_attempts WHERE organization_id=? AND status='pending_review'",org));assertEquals(200,db.count("SELECT COUNT(*) FROM attempt_questions WHERE organization_id=? AND status='answered' AND final_points=1",org));
        double stateP95=p95(stateTimes),answerP95=p95(answerTimes);
        var environment=Map.of("os",System.getProperty("os.name"),"architecture",System.getProperty("os.arch"),"processors",Runtime.getRuntime().availableProcessors(),"java",System.getProperty("java.version"),"database",System.getenv("EXAMAI_TEST_DATABASE_URL"),"poolSize",10);
        var report=Map.of("environment",environment,"concurrentLearners",200,"httpStateP95Ms",stateP95,"httpAnswerP95Ms",answerP95,"targetUnder1000Ms",stateP95<1000 && answerP95<1000,"answeredRows",200,"duplicateRetryRows",0,"organizationFixture",org);
        Path directory=Path.of("..",".artifacts");Files.createDirectories(directory);Files.writeString(directory.resolve("load-report.json"),db.json(report));System.out.println("EXAMAI_LOAD_REPORT "+db.json(report));
    }
    private List<Double> burst(HttpClient http,long org,List<Fixture> fixtures,boolean answer) throws Exception {
        CountDownLatch ready=new CountDownLatch(200),start=new CountDownLatch(1);List<Future<Double>> results=new ArrayList<>();
        try(var pool=Executors.newVirtualThreadPerTaskExecutor()) {
            for(var fixture:fixtures) results.add(pool.submit(()-> {
                String path="/api/v1/attempts/"+fixture.attempt()+"/"+(answer?"questions/"+number(fixture.question(),"id")+"/answer":"state");
                var builder=HttpRequest.newBuilder(URI.create("http://localhost:"+port+path)).timeout(Duration.ofSeconds(30)).header("Authorization","Bearer "+fixture.token()).header("X-Organization-Id",Long.toString(org)).header("X-Exam-Session",fixture.session().sessionToken()).header("X-Exam-Browser",fixture.session().browserId());
                if(answer) {
                    var options=(List<?>)fixture.question().get("options");var option=db.object(db.json(options.getFirst()));
                    String body=db.json(new AttemptService.AnswerRequest("load-answer-"+fixture.attempt(),string(fixture.question(),"open_instance"),new AttemptService.Answer(List.of(string(option,"id")),"")));
                    builder.header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(body));
                }
                ready.countDown();assertTrue(start.await(20,TimeUnit.SECONDS));long begin=System.nanoTime();var response=http.send(builder.build(),HttpResponse.BodyHandlers.ofString());double ms=(System.nanoTime()-begin)/1_000_000d;assertEquals(200,response.statusCode(),response.body());return ms;
            }));
            assertTrue(ready.await(20,TimeUnit.SECONDS));start.countDown();List<Double> times=new ArrayList<>();for(var future:results) times.add(future.get(40,TimeUnit.SECONDS));return times;
        }
    }
    private double p95(List<Double> data) {return data.stream().sorted().toList().get((int)Math.ceil(data.size()*0.95)-1);}
    private record Fixture(String token,AttemptService.StartRequest session,long attempt,Map<String,Object> question) {}
}
