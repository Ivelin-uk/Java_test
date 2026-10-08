package com.quicktest;

import com.quicktest.auth.*;
import com.quicktest.workspace.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import static com.quicktest.workspace.WorkspaceStore.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties={"app.legacy-api.enabled=false","app.workspace.workers=false","app.workspace.demo-seed=false"})
@AutoConfigureMockMvc
class WorkspaceTests {
    @DynamicPropertySource static void database(DynamicPropertyRegistry registry) {
        String url=System.getenv().getOrDefault("EXAMAI_TEST_DATABASE_URL","jdbc:h2:mem:workspace_tests;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1");
        if(url.contains("/test_ai")) throw new IllegalArgumentException("Never run verification against the user's database");
        registry.add("spring.datasource.url",()->url);
        registry.add("spring.datasource.username",()->System.getenv().getOrDefault("EXAMAI_TEST_DATABASE_USERNAME","sa"));
        registry.add("spring.datasource.password",()->System.getenv().getOrDefault("EXAMAI_TEST_DATABASE_PASSWORD",""));
    }
    @MockitoBean Clock clock;
    @Autowired WorkspaceStore db;
    @Autowired AppUserRepository users;
    @Autowired PasswordEncoder passwords;
    @Autowired AuthService auth;
    @Autowired OrganizationService organizations;
    @Autowired AssessmentService assessments;
    @Autowired AssignmentService assignments;
    @Autowired AttemptService attempts;
    @Autowired GradingService grading;
    @Autowired IdentityWorkflow identity;
    @Autowired WorkspaceAiService ai;
    @Autowired MockMvc mvc;
    @Autowired QuestionBankService bank;
    @Autowired OrganizationControls controls;
    @Autowired TenantPermissions permissions;
    @Autowired PrivateImageService images;
    @Autowired RetentionService retention;
    @Autowired WorkspaceCrypto crypto;
    @Autowired NotificationService notifications;
    @Autowired CodeRateLimiter codeLimiter;
    @Autowired WorkspaceAudit audit;
    @Autowired ProfileExamMutex mutex;
    @Autowired org.springframework.transaction.support.TransactionTemplate transactions;
    long org,other,teacher,student,version,assignment;String code,authorization;
    OrgAccess.Scope teaching,learning;
    Instant now=Instant.parse("2026-10-06T10:00:00Z");
    @BeforeEach void prepare() {
        when(clock.instant()).thenReturn(now);
        AppUser t=user(Role.TEACHER),s=user(Role.STUDENT),otherUser=user(Role.TEACHER);teacher=t.getId();student=s.getId();
        org=number(organizations.create(teacher,new OrganizationService.OrganizationRequest("School "+UUID.randomUUID(),"school",t.getEmail(),"Europe/Sofia","Ученик")),"id");
        other=number(organizations.create(otherUser.getId(),new OrganizationService.OrganizationRequest("Other school","school",otherUser.getEmail(),"Europe/Sofia","Ученик")),"id");
        db.insert("INSERT INTO memberships(organization_id,user_id,roles_json,created_at) VALUES(?,?,?,?)",org,student,"[\"STUDENT\"]",now);
        teaching=new OrgAccess.Scope(org,teacher,Set.of("ORG_ADMIN","TEACHER"));learning=new OrgAccess.Scope(org,student,Set.of("STUDENT"));
        var test=assessments.save(teaching,null,definition(false));version=number(assessments.publish(teaching,number(test,"id")),"id");
        var a=assignments.create(teaching,new AssignmentService.AssignmentRequest(version,List.of(),List.of(student),now.minusSeconds(1),now.plusSeconds(3600),1,false,false,true));assignment=number(a,"id");code=string(a,"code");
        authorization="Bearer "+auth.login(new AuthService.LoginRequest(s.getEmail(),"password123")).token();
    }
    private AppUser user(Role role) {
        var user=new AppUser();user.setName("Test account");user.setEmail(UUID.randomUUID()+"@example.test");user.setRole(role);user.setEmailVerifiedAt(now);user.setPasswordHash(passwords.encode("password123"));users.saveAndFlush(user);identity.initialize(user);return user;
    }
    private AssessmentService.Definition definition(boolean manual) {
        List<AssessmentService.Question> questions=new ArrayList<>();
        questions.add(new AssessmentService.Question("SINGLE_CHOICE","Which is correct?","EASY",BigDecimal.ONE,30,List.of(new AssessmentService.Option("Correct",true),new AssessmentService.Option("Wrong",false)),List.of(),true,true,"","Private explanation"));
        if(manual) questions.add(new AssessmentService.Question("OPEN_ANSWER","Explain","MEDIUM",BigDecimal.ONE,60,List.of(),List.of(),true,true,"Private criteria","Private explanation"));
        return new AssessmentService.Definition("Test","","","","Instructions","bg","bulgarian",new BigDecimal("50"),questions);
    }
    private AttemptService.StartRequest startRequest() {return new AttemptService.StartRequest(code,UUID.randomUUID().toString(),UUID.randomUUID().toString(),"a".repeat(43),true,true,true);}
    @Test void groupsHaveOneTeacherAndOnlyAcceptStudents() {
        long group=number(organizations.createGroup(teaching,new OrganizationService.GroupRequest("One teacher","","","2026/2027","")),"id");
        AppUser second=user(Role.TEACHER);
        db.insert("INSERT INTO memberships(organization_id,user_id,roles_json,created_at) VALUES(?,?,?,?)",org,second.getId(),"[\"TEACHER\"]",now);
        assertThrows(WorkspaceError.class,()->organizations.addTeacher(teaching,group,second.getId()));
        assertThrows(WorkspaceError.class,()->organizations.removeTeacher(teaching,group,teacher));
        assertThrows(WorkspaceError.class,()->organizations.addStudent(teaching,group,second.getId()));
        assertThrows(org.springframework.dao.DataIntegrityViolationException.class,()->db.update("INSERT INTO group_teachers(organization_id,group_id,user_id) VALUES(?,?,?)",org,group,second.getId()));
        organizations.addStudent(teaching,group,student);
        assertEquals(1,db.count("SELECT COUNT(*) FROM group_teachers WHERE group_id=?",group));
        assertEquals(1,db.count("SELECT COUNT(*) FROM group_members WHERE group_id=? AND user_id=? AND active=TRUE",group,student));
    }
    @Test void assessmentListIncludesQuestionCountAndTotalTime() {
        var saved=assessments.save(teaching,null,definition(true));
        var row=assessments.list(teaching).stream().filter(value->number(value,"id")==number(saved,"id")).findFirst().orElseThrow();
        assertEquals(2,number(row,"question_count"));
        assertEquals(90,number(row,"total_time_seconds"));
        assertFalse(row.containsKey("definition_json"));
    }
    private AttemptService.Session session(AttemptService.StartRequest r) {return new AttemptService.Session(r.sessionToken(),r.browserId(),authorization);}
    private Map<String,Object> start(AttemptService.StartRequest r) {return attempts.start(learning,assignment,r,authorization,"127.0.0.1");}
    @SuppressWarnings("unchecked") private Map<String,Object> question(Map<String,Object> state) {return (Map<String,Object>)state.get("question");}
    @SuppressWarnings("unchecked") private AttemptService.Answer correct(Map<String,Object> q) {return new AttemptService.Answer(List.of(string(((List<Map<String,Object>>)q.get("options")).getFirst(),"id")),"");}

    @Test void tenantSelectorsAndStudentPrivilegesAreEnforcedAtHttpBoundary() throws Exception {
        mvc.perform(get("/api/v1/groups").header("Authorization",authorization).header("X-Organization-Id",other)).andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/tests").header("Authorization",authorization).header("X-Organization-Id",org)).andExpect(status().isForbidden());
        mvc.perform(get("/api/tests").header("Authorization",authorization)).andExpect(status().isGone());
        assertThrows(WorkspaceError.class,()->assessments.get(new OrgAccess.Scope(other,teacher,Set.of("TEACHER")),1,false));
    }

    @Test void teacherRegistrationWorksWithoutSchoolOrInvitation() throws Exception {
        var response=mvc.perform(post("/api/auth/register").contentType("application/json")
                .content(db.json(Map.of("name","Independent teacher","email",UUID.randomUUID()+"@example.test","password","password123","role","TEACHER"))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        var registered=db.object(response);
        String bearer="Bearer "+registered.get("token");
        mvc.perform(get("/api/v1/tests").header("Authorization",bearer)).andExpect(status().isOk());
        mvc.perform(post("/api/v1/tests").header("Authorization",bearer).contentType("application/json").content(db.json(definition(false))))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/members").header("Authorization",bearer)).andExpect(status().isOk());
        mvc.perform(post("/api/v1/organizations").header("Authorization",bearer).contentType("application/json").content("{}"))
                .andExpect(status().isNotFound());
    }

    @Test void anyRegisteredStudentCanReceiveAnExistingTeachersTest() throws Exception {
        var learner=user(Role.STUDENT);
        String learnerToken="Bearer "+auth.login(new AuthService.LoginRequest(learner.getEmail(),"password123")).token();
        String teacherToken="Bearer "+auth.login(new AuthService.LoginRequest(users.findById(teacher).orElseThrow().getEmail(),"password123")).token();
        db.update("UPDATE organization_subscriptions SET paid_through=? WHERE organization_id=?",now,org);
        var request=new AssignmentService.AssignmentRequest(version,List.of(),List.of(learner.getId()),now.minusSeconds(1),now.plusSeconds(3600),1,false,false,true);
        var response=mvc.perform(post("/api/v1/assignments").header("Authorization",teacherToken).contentType("application/json").content(db.json(request)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        var created=db.object(response);long id=number(created,"id");
        mvc.perform(get("/api/v1/assignments").header("Authorization",learnerToken)).andExpect(status().isOk()).andExpect(jsonPath("$[0].id").value(id));
        mvc.perform(get("/api/v1/assignments/"+id+"/preflight").header("Authorization",learnerToken)).andExpect(status().isOk());
        var start=new AttemptService.StartRequest(string(created,"code"),UUID.randomUUID().toString(),UUID.randomUUID().toString(),"b".repeat(43),true,true,true);
        mvc.perform(post("/api/v1/assignments/"+id+"/attempts").header("Authorization",learnerToken).contentType("application/json").content(db.json(start)))
                .andExpect(status().isOk());
        var stranger=user(Role.STUDENT);
        String strangerToken="Bearer "+auth.login(new AuthService.LoginRequest(stranger.getEmail(),"password123")).token();
        mvc.perform(get("/api/v1/assignments/"+id+"/preflight").header("Authorization",strangerToken)).andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/tests").header("Authorization",learnerToken)).andExpect(status().isForbidden());
    }

    @Test void existingPersonalContentIsVisibleWithoutASelectorAndRemainsPrivate() throws Exception {
        String teacherToken="Bearer "+auth.login(new AuthService.LoginRequest(users.findById(teacher).orElseThrow().getEmail(),"password123")).token();
        long test=number(db.one("SELECT assessment_id FROM assessment_versions WHERE id=?",version),"assessment_id");
        mvc.perform(get("/api/v1/tests").header("Authorization",teacherToken)).andExpect(status().isOk()).andExpect(jsonPath("$[?(@.id == "+test+")]").isNotEmpty());
        mvc.perform(get("/api/v1/tests/"+test).header("Authorization",teacherToken)).andExpect(status().isOk());
        mvc.perform(get("/api/v1/assignments").header("Authorization",authorization)).andExpect(status().isOk()).andExpect(jsonPath("$[0].id").value(assignment));
        var stranger=user(Role.TEACHER);
        String bearer="Bearer "+auth.login(new AuthService.LoginRequest(stranger.getEmail(),"password123")).token();
        mvc.perform(get("/api/v1/tests/"+test).header("Authorization",bearer)).andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/assignments/"+assignment+"/monitoring").header("Authorization",bearer)).andExpect(status().isForbidden());
    }

    @Test void newPersonalTestCanBeAssignedToAnExistingGroup() throws Exception {
        long group=number(organizations.createGroup(teaching,new OrganizationService.GroupRequest("Existing group","","Java","2026","")),"id");
        organizations.addStudent(teaching,group,student);
        String bearer="Bearer "+auth.login(new AuthService.LoginRequest(users.findById(teacher).orElseThrow().getEmail(),"password123")).token();
        var created=db.object(mvc.perform(post("/api/v1/tests").header("Authorization",bearer).contentType("application/json").content(db.json(definition(false))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        var published=db.object(mvc.perform(post("/api/v1/tests/"+number(created,"id")+"/publish").header("Authorization",bearer))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        var request=new AssignmentService.AssignmentRequest(number(published,"id"),List.of(group),List.of(),now.minusSeconds(1),now.plusSeconds(3600),1,false,false,true);
        var assigned=db.object(mvc.perform(post("/api/v1/assignments").header("Authorization",bearer).contentType("application/json").content(db.json(request)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        mvc.perform(get("/api/v1/groups/"+group+"/summary").header("Authorization",bearer)).andExpect(status().isOk())
                .andExpect(jsonPath("$.assignments[0].assignment_id").value(number(assigned,"id")));
        mvc.perform(get("/api/v1/groups/"+group+"/summary").header("Authorization",authorization)).andExpect(status().isOk())
                .andExpect(jsonPath("$.assignments[0].student_id").value(student));
    }

    @Test void sharedHistoricalTestCanBeCopiedAndNewImagesRemainPrivate() throws Exception {
        long test=number(db.one("SELECT assessment_id FROM assessment_versions WHERE id=?",version),"assessment_id");
        assessments.share(teaching,test,true);
        var colleague=user(Role.TEACHER);
        String bearer="Bearer "+auth.login(new AuthService.LoginRequest(colleague.getEmail(),"password123")).token();
        var copied=db.object(mvc.perform(post("/api/v1/tests/"+test+"/duplicate").header("Authorization",bearer))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        long copy=number(copied,"id");
        var output=new java.io.ByteArrayOutputStream();
        javax.imageio.ImageIO.write(new java.awt.image.BufferedImage(2,2,java.awt.image.BufferedImage.TYPE_INT_RGB),"png",output);
        var uploaded=db.object(mvc.perform(post("/api/v1/files").header("Authorization",bearer).contentType("application/json")
                .content(db.json(new PrivateImageService.Upload("question",Base64.getEncoder().encodeToString(output.toByteArray())))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        long image=number(uploaded,"id");var q=definition(false).questions().getFirst();
        var question=new AssessmentService.Question(q.type(),q.text(),q.difficulty(),q.points(),q.timeSeconds(),q.options(),q.acceptedAnswers(),true,true,"","",image);
        var changed=new AssessmentService.Definition("Private copy","","","","","bg","bulgarian",new BigDecimal("50"),List.of(question));
        mvc.perform(put("/api/v1/tests/"+copy).header("Authorization",bearer).contentType("application/json").content(db.json(changed)))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/files/"+image).header("Authorization",authorization)).andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/files/"+image).header("Authorization",bearer)).andExpect(status().isOk());
    }

    @Test void chatEndpointsAreRemovedForAllRoles() throws Exception {
        for (Role role : Role.values()) {
            var account = user(role);
            String bearer = "Bearer " + auth.login(new AuthService.LoginRequest(account.getEmail(), "password123")).token();
            for (String path : List.of("/api/v1/conversations", "/api/v1/conversations/1/messages"))
                mvc.perform(get(path).header("Authorization", bearer).header("X-Organization-Id", org)).andExpect(status().isNotFound());
            mvc.perform(get("/ws/chat").header("Authorization", bearer)).andExpect(status().isForbidden());
            mvc.perform(post("/api/v1/conversations").header("Authorization", bearer)
                    .header("X-Organization-Id", org).contentType("application/json").content("{}"))
                    .andExpect(status().isNotFound());
        }
    }
    @Test void questionBankAndSupportAreScopedAndRevocable() {
        var item=(Map<?,?>)bank.save(teaching,new QuestionBankService.Item("Java",true,definition(false).questions().getFirst()));
        assertEquals(1,((List<?>)bank.list(teaching)).size());assertTrue(((List<?>)bank.list(new OrgAccess.Scope(other,teacher,Set.of("TEACHER")))).isEmpty());
        assertThrows(WorkspaceError.class,()->bank.remove(new OrgAccess.Scope(org,student,Set.of("TEACHER")),((Number)item.get("id")).longValue()));
        var administrator=user(Role.ADMIN);assertThrows(WorkspaceError.class,()->controls.supportAccess(administrator.getId(),org));
        var grant=(Map<?,?>)controls.support(teaching,new OrganizationControls.Support(administrator.getId(),"Explicit support",1));controls.supportAccess(administrator.getId(),org);
        controls.revokeSupport(teaching,((Number)grant.get("id")).longValue());assertThrows(WorkspaceError.class,()->controls.supportAccess(administrator.getId(),org));
        String exported=db.json(controls.export(teaching));assertFalse(exported.contains("session_hash"));assertFalse(exported.contains("code_hash"));
    }
    @Test void privateImagesAreValidatedTenantScopedAndVisibleOnlyForOpenedQuestion() throws Exception {
        var output=new java.io.ByteArrayOutputStream();javax.imageio.ImageIO.write(new java.awt.image.BufferedImage(2,2,java.awt.image.BufferedImage.TYPE_INT_RGB),"png",output);String png=Base64.getEncoder().encodeToString(output.toByteArray());
        var file=(Map<?,?>)images.upload(teaching,new PrivateImageService.Upload("question",png));long image=((Number)file.get("id")).longValue();
        assertThrows(WorkspaceError.class,()->images.upload(teaching,new PrivateImageService.Upload("question",Base64.getEncoder().encodeToString("<svg/>".getBytes()))));
        var original=definition(false).questions().getFirst();var q=new AssessmentService.Question(original.type(),original.text(),original.difficulty(),original.points(),original.timeSeconds(),original.options(),original.acceptedAnswers(),true,true,"","",image);
        var definition=new AssessmentService.Definition("Image test","","","","","bg","bulgarian",new BigDecimal("50"),List.of(q));long test=number(assessments.save(teaching,null,definition),"id");long version=number(assessments.publish(teaching,test),"id");var a=assignments.create(teaching,new AssignmentService.AssignmentRequest(version,List.of(),List.of(student),now,now.plusSeconds(3600),1,false,false,true));assignment=number(a,"id");code=string(a,"code");
        assertThrows(WorkspaceError.class,()->images.download(new OrgAccess.Scope(other,teacher,Set.of("TEACHER")),image,null,session(startRequest())));
        assertThrows(WorkspaceError.class,()->images.download(learning,image,null,session(startRequest())));
        var r=startRequest();var state=start(r);assertEquals(image,number(question(state),"imageId"));assertEquals("image/png",images.download(learning,image,number(state,"id"),session(r)).mime());
        attempts.answer(learning,number(state,"id"),number(question(state),"id"),session(r),new AttemptService.AnswerRequest("image-answer-key",string(question(state),"open_instance"),correct(question(state))));assertThrows(WorkspaceError.class,()->images.download(learning,image,number(state,"id"),session(r)));
    }
    @Test void approvedRetentionDeletesOldContentButNeverResetsAttemptLimits() {
        var r=startRequest();var state=start(r);long id=number(state,"id");var q=question(state);attempts.answer(learning,id,number(q,"id"),session(r),new AttemptService.AnswerRequest("retention-answer",string(q,"open_instance"),correct(q)));grading.finalizeResult(teaching,id,new GradingService.Finalize("retention-final","","",""),false);
        assertThrows(WorkspaceError.class,()->retention.preview(teaching));
        controls.settings(teaching,new OrganizationControls.Settings(new OrganizationService.OrganizationRequest("Retention school","school","school@example.test","Europe/Sofia","Ученик"),30,true,"bulgarian",new BigDecimal("50")));
        when(clock.instant()).thenReturn(now.plusSeconds(31*86400L));var request=new RetentionService.Request("retention-key-test","password123","Approved policy");retention.run(teaching,request);retention.run(teaching,request);
        assertEquals("redacted",string(db.one("SELECT status FROM exam_attempts WHERE id=?",id),"status"));assertEquals(0,db.count("SELECT COUNT(*) FROM attempt_questions WHERE attempt_id=?",id));assertEquals(0,db.count("SELECT COUNT(*) FROM result_revisions WHERE attempt_id=?",id));assertEquals(1,db.count("SELECT COUNT(*) FROM retention_runs WHERE organization_id=?",org));assertEquals(1,db.count("SELECT COUNT(*) FROM exam_attempts WHERE assignment_id=? AND student_id=?",assignment,student));
    }
    @Test void organizationPermissionChangeIsEnforcedOnTheNextRequest() throws Exception {
        mvc.perform(get("/api/v1/groups").header("Authorization",authorization).header("X-Organization-Id",org)).andExpect(status().isOk());
        permissions.update(teaching,new TenantPermissions.Change("OrganizationController.groups","STUDENT",false));
        mvc.perform(get("/api/v1/groups").header("Authorization",authorization).header("X-Organization-Id",org)).andExpect(status().isForbidden());
        assertThrows(WorkspaceError.class,()->permissions.update(teaching,new TenantPermissions.Change("AssessmentController.publish","STUDENT",true)));
    }
    @Test void failedAiReleasesReservationRetryCountsOnlyOnceAndNeverPublishes() {
        var request=new WorkspaceAiService.Generate("ai-failure-test","Java","","","bg",1,"EASY","");long id=number(ai.enqueue(teaching,request),"id");
        var failed=new WorkspaceAiService(db,r->{throw new IllegalStateException("invalid JSON or timeout");},organizations,assessments,transactions,clock,true);for(int n=0;n<20 && string(ai.get(teaching,id),"status").equals("queued");n++) failed.process();
        assertEquals("failed",string(ai.get(teaching,id),"status"));assertEquals(0,number(organizations.subscription(org),"ai_reserved"));assertEquals(0,number(organizations.subscription(org),"ai_used"));
        ai.retry(teaching,id);var worker=new WorkspaceAiService(db,new com.quicktest.ai.MockAiProvider(),organizations,assessments,transactions,clock,true);long versions=db.count("SELECT COUNT(*) FROM assessment_versions WHERE organization_id=?",org);worker.process();worker.process();
        assertEquals("completed",string(ai.get(teaching,id),"status"));assertEquals(1,number(organizations.subscription(org),"ai_used"));assertEquals(0,number(organizations.subscription(org),"ai_reserved"));assertEquals(versions,db.count("SELECT COUNT(*) FROM assessment_versions WHERE organization_id=?",org));
    }
    @Test void aiFailureRetainsActionableProviderMessage() {
        long id=number(ai.enqueue(teaching,new WorkspaceAiService.Generate("ai-offline-test","Java","","","bg",1,"EASY","")),"id");
        var worker=new WorkspaceAiService(db,r->{throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"Моделът за AI генериране не е зареден.");},organizations,assessments,transactions,clock,true);
        for(int n=0;n<20 && string(ai.get(teaching,id),"status").equals("queued");n++) worker.process();
        assertEquals("failed",string(ai.get(teaching,id),"status"));
        assertEquals("Моделът за AI генериране не е зареден.",string(ai.get(teaching,id),"error_message"));
        assertEquals(0,number(organizations.subscription(org),"ai_reserved"));
    }
    @Test void immutableVersionsAndDeduplicatedRecipientSnapshot() {
        long group=number(organizations.createGroup(teaching,new OrganizationService.GroupRequest("Group","","Java","2026","12")),"id");organizations.addStudent(teaching,group,student);
        var assigned=assignments.create(teaching,new AssignmentService.AssignmentRequest(version,List.of(group),List.of(student),now,now.plusSeconds(1000),1,false,false,true));assertEquals(1L,number(assigned,"recipients"));
        long test=number(db.one("SELECT assessment_id FROM assessment_versions WHERE id=?",version),"assessment_id");
        assessments.save(teaching,test,definition(true));assertEquals(1,db.parse(db.one("SELECT definition_json FROM assessment_versions WHERE id=?",version).get("definition_json"),AssessmentService.Definition.class).questions().size());
    }
    @Test void groupDeletionHidesGroupWithoutRemovingAssignmentsRecipientsOrAttempts() throws Exception {
        long group=number(organizations.createGroup(teaching,new OrganizationService.GroupRequest("Delete group","","Java","2026","12")),"id");
        organizations.addStudent(teaching,group,student);
        var assigned=assignments.create(teaching,new AssignmentService.AssignmentRequest(version,List.of(group),List.of(),now.minusSeconds(1),now.plusSeconds(3600),1,false,false,true));
        assignment=number(assigned,"id");code=string(assigned,"code");long attempt=number(start(startRequest()),"id");
        String teacherToken="Bearer "+auth.login(new AuthService.LoginRequest(users.findById(teacher).orElseThrow().getEmail(),"password123")).token();
        mvc.perform(delete("/api/v1/groups/"+group).header("Authorization",authorization)).andExpect(status().isForbidden());
        mvc.perform(delete("/api/v1/groups/"+group).header("Authorization",teacherToken)).andExpect(status().isOk());
        assertEquals("deleted",string(db.one("SELECT status FROM learning_groups WHERE id=?",group),"status"));
        assertTrue(organizations.groups(teaching).stream().noneMatch(row->number(row,"id")==group));
        assertTrue(organizations.groups(learning).stream().noneMatch(row->number(row,"id")==group));
        assertEquals(1,db.count("SELECT COUNT(*) FROM exam_assignments WHERE id=?",assignment));
        assertEquals(1,db.count("SELECT COUNT(*) FROM assignment_recipients WHERE assignment_id=? AND canceled=FALSE",assignment));
        assertEquals(1,db.count("SELECT COUNT(*) FROM exam_attempts WHERE id=?",attempt));
        mvc.perform(get("/api/v1/groups/"+group+"/summary").header("Authorization",teacherToken)).andExpect(status().isNotFound());
        mvc.perform(delete("/api/v1/groups/"+group).header("Authorization",teacherToken)).andExpect(status().isNotFound());
        assertThrows(WorkspaceError.class,()->organizations.updateGroup(teaching,group,new OrganizationService.GroupChange(new OrganizationService.GroupRequest("Restored","","","",""),"active")));
        assertThrows(WorkspaceError.class,()->assignments.create(teaching,new AssignmentService.AssignmentRequest(version,List.of(group),List.of(),now,now.plusSeconds(3600),1,false,false,true)));
    }
    @Test void groupEditingAndDeletionRequireAnAssignedTeacher() {
        long group=number(organizations.createGroup(teaching,new OrganizationService.GroupRequest("Original","","Java","2026","12")),"id");
        var change=new OrganizationService.GroupChange(new OrganizationService.GroupRequest("Edited","Description","Math","2027","11"),"active");
        var outsider=new OrgAccess.Scope(org,user(Role.TEACHER).getId(),Set.of("TEACHER"),true);
        assertThrows(WorkspaceError.class,()->organizations.updateGroup(outsider,group,change));
        assertThrows(WorkspaceError.class,()->organizations.deleteGroup(outsider,group));
        organizations.updateGroup(new OrgAccess.Scope(other,teacher,Set.of("TEACHER"),true),group,change);
        var edited=organizations.groupAccess(teaching,group);
        assertEquals("Edited",string(edited,"name"));assertEquals("Description",string(edited,"description"));
        assertEquals("Math",string(edited,"subject"));assertEquals("2027",string(edited,"school_year"));assertEquals("11",string(edited,"class_label"));
        assertThrows(WorkspaceError.class,()->organizations.updateGroup(teaching,group,new OrganizationService.GroupChange(new OrganizationService.GroupRequest(" ","","","",""),"active")));
        assertThrows(WorkspaceError.class,()->organizations.updateGroup(teaching,group,new OrganizationService.GroupChange(change.profile(),null)));
    }
    @Test void concurrentStartsProduceOneAttemptAndSameSnapshot() throws Exception {
        var r=startRequest();try(var pool=Executors.newFixedThreadPool(8)) {
            List<Callable<Long>> work=new ArrayList<>();for(int i=0;i<8;i++) work.add(()->number(start(r),"id"));
            var values=pool.invokeAll(work);Set<Long> ids=new HashSet<>();for(var value:values) ids.add(value.get(15,TimeUnit.SECONDS));assertEquals(1,ids.size());
        }
        assertEquals(1,db.count("SELECT COUNT(*) FROM exam_attempts WHERE organization_id=? AND assignment_id=?",org,assignment));assertThrows(WorkspaceError.class,()->start(startRequest()));
    }
    @Test void exactDeadlineRejectsCorrectAnswerAndDraftAndRetry() {
        var r=startRequest();var state=start(r);var q=question(state);long id=number(state,"id"),qid=number(q,"id");var response=new AttemptService.AnswerRequest("answer-key-123",string(q,"open_instance"),correct(q));
        attempts.draft(learning,id,qid,session(r),response);when(clock.instant()).thenReturn(Instant.parse(string(q,"deadline_at")));
        assertEquals("pending_review",string(attempts.answer(learning,id,qid,session(r),response),"status"));attempts.answer(learning,id,qid,session(r),response);
        var stored=db.one("SELECT * FROM attempt_questions WHERE id=?",qid);assertEquals("timed_out",string(stored,"status"));assertEquals(0,decimal(stored,"final_points").compareTo(BigDecimal.ZERO));assertNull(stored.get("answer_json"));
    }
    @Test void answerBeforeDeadlineScoresAndPayloadDoesNotContainPrivateKeys() {
        var r=startRequest();var state=start(r);var q=question(state);String payload=db.json(state);
        for(String privateKey:List.of("acceptedAnswers","criteria","correct","explanation","definition_json","session_hash")) assertFalse(payload.contains("\""+privateKey+"\""),privateKey);
        when(clock.instant()).thenReturn(Instant.parse(string(q,"deadline_at")).minusMillis(1));
        attempts.answer(learning,number(state,"id"),number(q,"id"),session(r),new AttemptService.AnswerRequest("answer-key-123",string(q,"open_instance"),correct(q)));
        assertEquals(0,decimal(db.one("SELECT final_points FROM attempt_questions WHERE id=?",number(q,"id")),"final_points").compareTo(BigDecimal.ONE));
        assertTrue(grading.results(learning).isEmpty());
    }
    @Test void violationsAreInstanceBoundAndBlurAloneDoesNotSanction() {
        long test=number(assessments.save(teaching,null,definition(true)),"id");long v=number(assessments.publish(teaching,test),"id");
        var a=assignments.create(teaching,new AssignmentService.AssignmentRequest(v,List.of(),List.of(student),now,now.plusSeconds(1000),1,false,false,true));assignment=number(a,"id");code=string(a,"code");
        var r=startRequest();var state=start(r);var q=question(state);long id=number(state,"id"),qid=number(q,"id");
        state=attempts.event(learning,id,session(r),new AttemptService.Event("blur-key-123",qid,string(q,"open_instance"),"blur",true,true));assertEquals("open",string(question(state),"status"));
        var exit=new AttemptService.Event("event-key-123",qid,string(q,"open_instance"),"fullscreen_exit",true,false);
        state=attempts.event(learning,id,session(r),exit);assertEquals("pending",string(question(state),"status"));assertNull(question(state).get("deadline_at"));
        state=attempts.open(learning,id,session(r),new AttemptService.Ready(true,true));long next=number(question(state),"id");
        attempts.event(learning,id,session(r),exit);state=attempts.event(learning,id,session(r),new AttemptService.Event("event-key-456",qid,string(q,"open_instance"),"visibility_hidden",false,false));assertEquals(next,number(question(state),"id"));assertEquals("open",string(question(state),"status"));
    }
    @Test void reviewPublicationOutboxAndCorrectionsAreAtomicAndIdempotent() {
        long test=number(assessments.save(teaching,null,definition(true)),"id");long v=number(assessments.publish(teaching,test),"id");var a=assignments.create(teaching,new AssignmentService.AssignmentRequest(v,List.of(),List.of(student),now,now.plusSeconds(1000),1,false,false,true));assignment=number(a,"id");code=string(a,"code");
        var r=startRequest();var state=start(r);long id=number(state,"id");var q=question(state);attempts.answer(learning,id,number(q,"id"),session(r),new AttemptService.AnswerRequest("answer-key-123",string(q,"open_instance"),correct(q)));
        state=attempts.open(learning,id,session(r),new AttemptService.Ready(true,true));q=question(state);attempts.answer(learning,id,number(q,"id"),session(r),new AttemptService.AnswerRequest("answer-key-456",string(q,"open_instance"),new AttemptService.Answer(List.of(),"Student text")));
        var publish=new GradingService.Finalize("publication-key-123","",null,null);assertThrows(WorkspaceError.class,()->grading.finalizeResult(teaching,id,publish,false));
        grading.grade(teaching,id,new GradingService.GradeRequest(number(q,"id"),BigDecimal.ONE,"Good",null));var result=grading.finalizeResult(teaching,id,publish,false);grading.finalizeResult(teaching,id,publish,false);
        assertEquals(1,db.count("SELECT COUNT(*) FROM result_revisions WHERE attempt_id=?",id));assertEquals(1,db.count("SELECT COUNT(*) FROM notification_outbox WHERE revision_id=?",number(result,"id")));
        db.update("UPDATE notification_outbox SET status='failed' WHERE revision_id=?",number(result,"id"));assertEquals("finalized",string(db.one("SELECT status FROM exam_attempts WHERE id=?",id),"status"));
        grading.grade(teaching,id,new GradingService.GradeRequest(number(q,"id"),BigDecimal.ZERO,"Correction","Incorrect explanation"));grading.finalizeResult(teaching,id,new GradingService.Finalize("correction-key-123","Corrected review",null,null),true);
        assertEquals(2,db.count("SELECT COUNT(*) FROM result_revisions WHERE attempt_id=?",id));assertEquals(2,db.count("SELECT COUNT(*) FROM notification_outbox WHERE organization_id=?",org));assertFalse(grading.studentResult(learning,id).containsKey("details"));
    }
    @Test void invitationAndNotificationAddressChangesAreSingleUse() {
        var newStudent=user(Role.STUDENT);var invite=organizations.invite(teaching,new OrganizationService.InvitationRequest(newStudent.getEmail(),List.of("STUDENT"),null));
        organizations.accept(newStudent.getId(),string(invite,"token"));assertThrows(WorkspaceError.class,()->organizations.accept(newStudent.getId(),string(invite,"token")));
        String old=string(identity.profile(newStudent),"email");identity.requestEmail(newStudent,"new-address@example.test","password123");assertEquals(old,string(identity.profile(newStudent),"email"));
        String token=string(db.object(db.one("SELECT payload_json FROM notification_outbox WHERE user_id=? ORDER BY id DESC LIMIT 1",newStudent.getId()).get("payload_json")),"token");identity.verify(token);assertEquals("new-address@example.test",string(identity.profile(newStudent),"email"));assertThrows(WorkspaceError.class,()->identity.verify(token));
    }
    @Test void sessionTransferRevokesOldSession() {
        var r=startRequest();var state=start(r);long id=number(state,"id");
        var changed=startRequest();attempts.transfer(learning,id,changed,"password123",authorization);assertThrows(WorkspaceError.class,()->attempts.getState(learning,id,session(r)));assertNotNull(attempts.getState(learning,id,session(changed)));
    }
    @Test void unsupportedFullscreenAndExpiredSubscriptionConsumeNoAttempt() {
        var r=startRequest();assertThrows(WorkspaceError.class,()->start(new AttemptService.StartRequest(r.code(),r.idempotencyKey(),r.browserId(),r.sessionToken(),false,false,true)));
        assertEquals(0,db.count("SELECT COUNT(*) FROM exam_attempts WHERE assignment_id=?",assignment));db.update("UPDATE organization_subscriptions SET paid_through=? WHERE organization_id=?",now,org);assertThrows(WorkspaceError.class,()->start(r));
    }
    @Test void incorrectCodesAreCountedDespiteTransactionRollback() {
        var r=startRequest();var wrong=new AttemptService.StartRequest("BADCODE1",r.idempotencyKey(),r.browserId(),r.sessionToken(),true,true,true);
        for(int i=0;i<5;i++) assertThrows(WorkspaceError.class,()->start(wrong));var error=assertThrows(WorkspaceError.class,()->start(r));assertEquals("rate_limit",error.code());
    }
    @Test void aiReservationsDeduplicateAndDoNotPublishAnything() {
        var request=new WorkspaceAiService.Generate("ai-request-123","Java","","","bg",2,"EASY","");var first=ai.enqueue(teaching,request);var second=ai.enqueue(teaching,request);assertEquals(number(first,"id"),number(second,"id"));assertEquals(1,number(organizations.subscription(org),"ai_reserved"));assertEquals(0,number(organizations.subscription(org),"ai_used"));
    }
    @Test void gradeBoundariesDoNotRoundUp() {
        for(String[] item:new String[][]{{"49.99","2"},{"50","3"},{"60","4"},{"75","5"},{"90","6"},{"100","6"}}) assertEquals(item[1],GradingService.bulgarianGrade(new BigDecimal(item[0]),new BigDecimal("100")));
    }
    @Test void MissingOrExpiredSessionTimestampReturnsUnauthorizedNotServerError() throws Exception {
        String missing="undated-"+UUID.randomUUID(),expired="expired-"+UUID.randomUUID();
        db.update("INSERT INTO auth_token(token,user_id,created_at) VALUES(?,?,NULL)",missing,student);
        db.update("INSERT INTO auth_token(token,user_id,created_at) VALUES(?,?,?)",expired,student,Instant.now().minusSeconds(86401));
        for(String token:List.of(missing,expired)) mvc.perform(get("/api/auth/me").header("Authorization","Bearer "+token)).andExpect(status().isUnauthorized());
    }
    @Test void simultaneousAiReservationsCannotExceedRemainingQuota() throws Exception {
        db.update("UPDATE organization_subscriptions SET ai_used=49 WHERE organization_id=?",org);
        try(var pool=Executors.newFixedThreadPool(8)) {
            List<Callable<Boolean>> work=new ArrayList<>();for(int i=0;i<8;i++) {int n=i;work.add(()->{try {ai.enqueue(teaching,new WorkspaceAiService.Generate("parallel-ai-"+n,"Java","","","bg",1,"EASY",""));return true;}catch(WorkspaceError full) {return false;}});}
            int successes=0;for(var result:pool.invokeAll(work)) if(result.get(15,TimeUnit.SECONDS)) successes++;assertEquals(1,successes);
        }
        assertEquals(1,number(organizations.subscription(org),"ai_reserved"));assertEquals(49,number(organizations.subscription(org),"ai_used"));
    }
    @Test void simultaneousInvitationsReserveOnlyAvailableTeacherSeats() throws Exception {
        try(var pool=Executors.newFixedThreadPool(8)) {
            List<Callable<Boolean>> work=new ArrayList<>();for(int i=0;i<8;i++) work.add(()->{try {organizations.invite(teaching,new OrganizationService.InvitationRequest("parallel-"+UUID.randomUUID()+"@example.test",List.of("TEACHER"),null));return true;}catch(WorkspaceError full) {return false;}});
            int successes=0;for(var result:pool.invokeAll(work)) if(result.get(15,TimeUnit.SECONDS)) successes++;assertEquals(4,successes);
        }
        assertEquals(4,db.count("SELECT COUNT(*) FROM organization_invitations WHERE organization_id=?",org));
    }
    @Test void newGroupMemberNeedsExplicitRecipientAdditionAndAdditionIsIdempotent() {
        long group=number(organizations.createGroup(teaching,new OrganizationService.GroupRequest("Snapshot group","","Java","2026","12")),"id");organizations.addStudent(teaching,group,student);
        long target=number(assignments.create(teaching,new AssignmentService.AssignmentRequest(version,List.of(group),List.of(student),now,now.plusSeconds(1000),1,false,false,true)),"id");
        var next=user(Role.STUDENT);db.insert("INSERT INTO memberships(organization_id,user_id,roles_json,created_at) VALUES(?,?,?,?)",org,next.getId(),"[\"STUDENT\"]",now);organizations.addStudent(teaching,group,next.getId());
        assertEquals(1,db.count("SELECT COUNT(*) FROM assignment_recipients WHERE assignment_id=?",target));assignments.addRecipient(teaching,target,next.getId());assignments.addRecipient(teaching,target,next.getId());assertEquals(2,db.count("SELECT COUNT(*) FROM assignment_recipients WHERE assignment_id=?",target));
    }
    @Test void abandonedAiResponseCannotCompleteOrChargeARetriedGeneration() {
        long id=number(ai.enqueue(teaching,new WorkspaceAiService.Generate("ai-lease-check","Lease test","","","bg",1,"EASY","")),"id");
        var mock=new com.quicktest.ai.MockAiProvider();
        var oldWorker=new WorkspaceAiService(db,r->{
            if(r.topic().equals("Lease test")) {
                when(clock.instant()).thenReturn(now.plusSeconds(601));
                new WorkspaceAiService(db,mock,organizations,assessments,transactions,clock,true).process();assertEquals("failed",string(ai.get(teaching,id),"status"));ai.retry(teaching,id);
            }
            return mock.generateTest(r);
        },organizations,assessments,transactions,clock,true);
        for(int i=0;i<20 && number(ai.get(teaching,id),"attempts")==0;i++) oldWorker.process();
        assertEquals("queued",string(ai.get(teaching,id),"status"));assertEquals(0,number(organizations.subscription(org),"ai_used"));
        var worker=new WorkspaceAiService(db,mock,organizations,assessments,transactions,clock,true);for(int i=0;i<20 && string(ai.get(teaching,id),"status").equals("queued");i++) worker.process();
        assertEquals("completed",string(ai.get(teaching,id),"status"));assertEquals(1,number(organizations.subscription(org),"ai_used"));assertEquals(0,number(organizations.subscription(org),"ai_reserved"));
    }
    @Test void sharedAssignmentRequiresExplicitTeacherGrantAndRevocationIsImmediate() {
        var colleague=user(Role.TEACHER);db.insert("INSERT INTO memberships(organization_id,user_id,roles_json,created_at) VALUES(?,?,?,?)",org,colleague.getId(),"[\"TEACHER\"]",now);
        var scope=new OrgAccess.Scope(org,colleague.getId(),Set.of("TEACHER"));
        var r=startRequest();var state=start(r);attempts.submit(learning,number(state,"id"),session(r));
        assertThrows(WorkspaceError.class,()->grading.review(scope,number(state,"id")));
        assignments.shareTeacher(teaching,assignment,colleague.getId(),true);assertEquals(1,grading.queue(scope).size());assertNotNull(grading.review(scope,number(state,"id")));
        assignments.shareTeacher(teaching,assignment,colleague.getId(),false);assertThrows(WorkspaceError.class,()->grading.review(scope,number(state,"id")));
    }
    @Test void explicitCodeDeliveryIsDeduplicatedPerGenerationAndChannel() {
        var delivery=new AssignmentService.CodeDelivery(code,"email");assignments.dispatchCode(teaching,assignment,delivery);assignments.dispatchCode(teaching,assignment,delivery);
        assertEquals(1,db.count("SELECT COUNT(*) FROM notification_outbox WHERE organization_id=? AND notification_type='assignment_code'",org));
        assertThrows(WorkspaceError.class,()->assignments.dispatchCode(teaching,assignment,new AssignmentService.CodeDelivery(code,"chat")));
        assertEquals(0,db.count("SELECT COUNT(*) FROM workspace_messages WHERE organization_id=?",org));
        code=string(assignments.rotate(teaching,assignment),"code");assignments.dispatchCode(teaching,assignment,new AssignmentService.CodeDelivery(code,"email"));
        assertEquals(2,db.count("SELECT COUNT(*) FROM notification_outbox WHERE organization_id=? AND notification_type='assignment_code'",org));assignments.revoke(teaching,assignment);assertThrows(WorkspaceError.class,()->assignments.dispatchCode(teaching,assignment,new AssignmentService.CodeDelivery(code,"email")));
    }
    @Test void mobileStrictStartConsumesNothingButAuditedExceptionWorks() throws Exception {
        var request=startRequest();mvc.perform(post("/api/v1/assignments/"+assignment+"/attempts").header("Authorization",authorization).header("X-Organization-Id",org).header("User-Agent","iPhone Mobile").contentType("application/json").content(db.json(request))).andExpect(status().isConflict());
        assertEquals(0,db.count("SELECT COUNT(*) FROM exam_attempts WHERE assignment_id=?",assignment));
        assignments.accommodate(teaching,assignment,student,new AssignmentService.Accommodation(true,new BigDecimal("2"),1,"Mobile accessibility exception"));
        var exempt=new AttemptService.StartRequest(code,request.idempotencyKey(),request.browserId(),request.sessionToken(),false,false,true);
        mvc.perform(post("/api/v1/assignments/"+assignment+"/attempts").header("Authorization",authorization).header("X-Organization-Id",org).header("User-Agent","iPhone Mobile").contentType("application/json").content(db.json(exempt))).andExpect(status().isOk());
        assertEquals(1,db.count("SELECT COUNT(*) FROM workspace_audit WHERE organization_id=? AND action='assignment.accommodation'",org));
    }
    @Test void deadlineWorkerClosesUnattendedAttemptWithoutClientRequests() {
        var r=startRequest();var state=start(r);long id=number(state,"id"),qid=number(question(state),"id");
        when(clock.instant()).thenReturn(Instant.parse(string(question(state),"deadline_at")));
        var worker=new AttemptService(db,clock,crypto,organizations,assignments,notifications,codeLimiter,transactions,passwords,audit,mutex,true);worker.expireDue();
        assertEquals("pending_review",string(db.one("SELECT status FROM exam_attempts WHERE id=?",id),"status"));assertEquals("timed_out",string(db.one("SELECT status FROM attempt_questions WHERE id=?",qid),"status"));assertEquals(BigDecimal.ZERO,decimal(db.one("SELECT final_points FROM attempt_questions WHERE id=?",qid),"final_points").stripTrailingZeros());
    }
    @Test void validCodeCannotBeUsedByUnassignedMemberOrReadOthersAttempt() throws Exception {
        var outsider=user(Role.STUDENT);db.insert("INSERT INTO memberships(organization_id,user_id,roles_json,created_at) VALUES(?,?,?,?)",org,outsider.getId(),"[\"STUDENT\"]",now);
        String token="Bearer "+auth.login(new AuthService.LoginRequest(outsider.getEmail(),"password123")).token();var r=startRequest();
        assertThrows(WorkspaceError.class,()->attempts.start(new OrgAccess.Scope(org,outsider.getId(),Set.of("STUDENT")),assignment,r,token,"127.0.0.2"));
        long id=number(start(r),"id");mvc.perform(get("/api/v1/attempts/"+id+"/state").header("Authorization",token).header("X-Organization-Id",org).header("X-Exam-Session",r.sessionToken()).header("X-Exam-Browser",r.browserId())).andExpect(status().isForbidden());
    }
    @Test void summaryUsesAttemptNumberNotCorrectionDateAndSkipsVoidedAttempts() {
        assignments.accommodate(teaching,assignment,student,new AssignmentService.Accommodation(false,BigDecimal.ONE,2,"Retake allowed"));
        var first=startRequest();long firstId=number(start(first),"id");attempts.submit(learning,firstId,session(first));grading.finalizeResult(teaching,firstId,new GradingService.Finalize("summary-first-key","",null,null),false);
        var second=startRequest();long secondId=number(start(second),"id");attempts.submit(learning,secondId,session(second));grading.finalizeResult(teaching,secondId,new GradingService.Finalize("summary-second-key","",null,null),false);
        grading.finalizeResult(teaching,firstId,new GradingService.Finalize("summary-correction","Older attempt correction","4",null),true);
        assertEquals(secondId,number(grading.assignmentResults(learning).getFirst(),"attempt_id"));grading.voidAttempt(teaching,secondId,"Invalid retake");assertEquals(firstId,number(grading.assignmentResults(learning).getFirst(),"attempt_id"));
    }
    @Test void exhaustedAiAndMemberQuotasRejectWithoutChangingExistingRecords() {
        db.update("UPDATE organization_subscriptions SET ai_used=50 WHERE organization_id=?",org);
        assertThrows(WorkspaceError.class,()->ai.enqueue(teaching,new WorkspaceAiService.Generate("quota-reject-key","Java","","","bg",1,"EASY","")));
        assertEquals(0,number(organizations.subscription(org),"ai_reserved"));assertEquals(1,assignments.list(learning).size());
        db.update("UPDATE organization_subscriptions SET plan_id=(SELECT id FROM organization_plans WHERE name='Starter') WHERE organization_id=?",org);
        List<String> invitations=new ArrayList<>();for(int i=0;i<4;i++) invitations.add(string(organizations.invite(teaching,new OrganizationService.InvitationRequest("quota-"+UUID.randomUUID()+"@example.test",List.of("TEACHER"),null)),"token"));
        assertThrows(WorkspaceError.class,()->organizations.invite(teaching,new OrganizationService.InvitationRequest("over-quota@example.test",List.of("TEACHER"),null)));assertEquals(4,invitations.size());
    }
}
