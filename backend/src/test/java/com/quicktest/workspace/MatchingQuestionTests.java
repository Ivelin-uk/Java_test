package com.quicktest.workspace;

import com.quicktest.workspace.repository.AssessmentRepository;
import com.quicktest.workspace.repository.ExamAttemptRepository;
import com.quicktest.workspace.repository.GradingRepository;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class MatchingQuestionTests {
    private static final Instant NOW=Instant.parse("2026-11-13T09:00:00Z");
    private static final Clock CLOCK=Clock.fixed(NOW,ZoneOffset.UTC);
    private final WorkspaceJson json=new WorkspaceJson(JsonMapper.builder().build());
    private final OrgAccess.Scope student=new OrgAccess.Scope(1,2,Set.of("STUDENT"),true);

    private AssessmentService.Question matching(List<AssessmentService.MatchingPair> pairs) {
        return new AssessmentService.Question("MATCHING","Свържи държавите със столиците.","EASY",new BigDecimal("5"),60,List.of(),List.of(),true,true,"","Private explanation",null,pairs);
    }
    private AssessmentService.Question matching() {
        return matching(List.of(new AssessmentService.MatchingPair("България","София"),new AssessmentService.MatchingPair("Франция","Париж"),new AssessmentService.MatchingPair("Италия","Рим")));
    }
    private AssessmentService assessments() {
        return new AssessmentService(mock(AssessmentRepository.class),json,mock(WorkspaceAudit.class),CLOCK,mock(PrivateImageService.class),mock(PersonalWorkspace.class),new WorkspaceCrypto());
    }
    private AssessmentService.Definition definition(AssessmentService.Question question) {
        return new AssessmentService.Definition("Тест","","","","","bg","percentage",new BigDecimal("50"),List.of(question));
    }

    @Test void acceptsBoundedPairsAndRejectsAmbiguousOrIncompatibleDefinitions() {
        var service=assessments();service.validate(definition(matching()));
        for(var pairs:List.of(List.<AssessmentService.MatchingPair>of(),List.of(new AssessmentService.MatchingPair("A","B")),
                List.of(new AssessmentService.MatchingPair("A","B"),new AssessmentService.MatchingPair(" a ","C")),
                List.of(new AssessmentService.MatchingPair("A","B"),new AssessmentService.MatchingPair("C"," b ")),
                List.of(new AssessmentService.MatchingPair("A","B"),new AssessmentService.MatchingPair("C"," ")),
                List.of(new AssessmentService.MatchingPair("A","B"),new AssessmentService.MatchingPair("C","x".repeat(4001))))) {
            assertThrows(WorkspaceError.class,()->service.validateQuestion(matching(pairs)));
        }
        assertThrows(WorkspaceError.class,()->service.validateQuestion(matching(Arrays.asList(new AssessmentService.MatchingPair("A","B"),null))));
        assertThrows(WorkspaceError.class,()->service.validateQuestion(matching(java.util.stream.IntStream.range(0,13).mapToObj(i->new AssessmentService.MatchingPair("L"+i,"R"+i)).toList())));
        var q=matching();
        assertThrows(WorkspaceError.class,()->service.validateQuestion(new AssessmentService.Question(q.type(),q.text(),q.difficulty(),q.points(),q.timeSeconds(),List.of(new AssessmentService.Option("Choice",true)),List.of(),true,true,"","",null,q.matchingPairs())));
        assertThrows(WorkspaceError.class,()->service.validateQuestion(new AssessmentService.Question(q.type(),q.text(),q.difficulty(),q.points(),q.timeSeconds(),List.of(),List.of("Text"),true,true,"","",null,q.matchingPairs())));
        assertThrows(WorkspaceError.class,()->service.validateQuestion(new AssessmentService.Question("OPEN_ANSWER",q.text(),q.difficulty(),q.points(),q.timeSeconds(),List.of(),List.of(),true,true,"Criteria","",null,q.matchingPairs())));
    }

    @Test void existingQuestionAndAnswerJsonRemainCompatible() {
        var original=new AssessmentService.Question("SINGLE_CHOICE","Choose","EASY",BigDecimal.ONE,30,List.of(new AssessmentService.Option("Yes",true),new AssessmentService.Option("No",false)),List.of(),true,true,"","");
        var old=json.object(json.write(original));old.remove("matchingPairs");
        var restored=json.parse(json.write(old),AssessmentService.Question.class);
        assertEquals(original,restored);assertTrue(restored.matchingPairs().isEmpty());assessments().validateQuestion(restored);
        assertEquals(new AttemptService.Answer(List.of("answer-id"),""),json.parse("{\"optionIds\":[\"answer-id\"],\"text\":\"\"}",AttemptService.Answer.class));
    }

    @Test void openedStateOnlyRevealsIndependentBlockIdsAndDraftCanBeRestored() {
        var fixture=new ExamFixture(matching());var state=fixture.start();
        var safe=map(state.get("question"));var snapshot=json.object(fixture.question.get("definition_json"));
        assertEquals("MATCHING",safe.get("type"));assertEquals(List.of(),safe.get("options"));
        assertFalse(safe.containsKey("matchingPairs"));assertFalse(safe.containsKey("matchingSolution"));
        assertFalse(json.write(safe).contains("Private explanation"));
        Set<String> ids=new HashSet<>();
        for(String side:List.of("matchingLeft","matchingRight")) {
            assertEquals(3,list(safe.get(side)).size());
            for(var block:list(safe.get(side))) {assertEquals(Set.of("id","text"),block.keySet());assertTrue(ids.add(block.get("id").toString()));assertDoesNotThrow(()->UUID.fromString(block.get("id").toString()));}
        }
        var expected=fixture.solution();assertEquals(3,expected.size());
        var left=index(list(snapshot.get("matchingLeft")));var right=index(list(snapshot.get("matchingRight")));
        for(var match:expected) assertTrue(matching().matchingPairs().contains(new AssessmentService.MatchingPair(left.get(match.leftId()),right.get(match.rightId()))));
        var answer=new AttemptService.Answer(List.of(),"",expected.subList(0,1));
        var restored=fixture.service.draft(student,3,7,fixture.session,new AttemptService.AnswerRequest("draft-key","open-id",answer));
        assertEquals(answer,json.parse(json.write(map(restored.get("question")).get("draft")),AttemptService.Answer.class));
        verify(fixture.repository,never()).saveAnswer(any(),anyString(),anyString(),any(),any(),anyBoolean(),anyLong(),anyLong());
    }

    @Test void pendingStateDoesNotRevealBlocksOrQuestionText() {
        var fixture=new ExamFixture(matching());fixture.start();fixture.question.put("status","pending");
        var safe=map(fixture.service.getState(student,3,fixture.session).get("question"));
        for(String field:List.of("text","type","matchingLeft","matchingRight","matchingSolution","matchingPairs")) assertFalse(safe.containsKey(field));
    }

    @Test void exactPairsAreAutomaticallyScoredAndIncompleteOrIncorrectPairsScoreZero() {
        for(int kind=0;kind<3;kind++) {
            var fixture=new ExamFixture(matching());fixture.start();var solution=fixture.solution();
            List<AttemptService.Match> submitted=kind==0?new ArrayList<>(solution):kind==1?solution.subList(0,1):List.of(new AttemptService.Match(solution.get(0).leftId(),solution.get(1).rightId()),new AttemptService.Match(solution.get(1).leftId(),solution.get(0).rightId()),solution.get(2));
            if(kind==0) Collections.reverse(submitted);
            fixture.service.answer(student,3,7,fixture.session,new AttemptService.AnswerRequest("answer-key","open-id",new AttemptService.Answer(List.of(),"",submitted)));
            BigDecimal points=kind==0?new BigDecimal("5"):BigDecimal.ZERO;
            verify(fixture.repository).saveAnswer(eq(NOW),anyString(),eq("answer-key"),eq(points),eq(points),eq(true),eq(1L),eq(7L));
        }
    }

    @Test void rejectsUnknownRepeatedMalformedAndCrossTypePairsBeforeSaving() {
        var fixture=new ExamFixture(matching());fixture.start();var solution=fixture.solution();var first=solution.getFirst();
        var invalid=new ArrayList<AttemptService.Answer>();
        invalid.add(new AttemptService.Answer(List.of(),"",List.of(new AttemptService.Match("foreign-left",first.rightId()))));
        invalid.add(new AttemptService.Answer(List.of(),"",List.of(new AttemptService.Match(first.leftId(),"foreign-right"))));
        invalid.add(new AttemptService.Answer(List.of(),"",List.of(first,first)));
        invalid.add(new AttemptService.Answer(List.of(),"",List.of(first,new AttemptService.Match(first.leftId(),solution.get(1).rightId()))));
        invalid.add(new AttemptService.Answer(List.of(),"",List.of(first,new AttemptService.Match(solution.get(1).leftId(),first.rightId()))));
        invalid.add(new AttemptService.Answer(List.of(),"",Arrays.asList((AttemptService.Match)null)));
        invalid.add(new AttemptService.Answer(List.of(),"",List.of(new AttemptService.Match(null,first.rightId()))));
        invalid.add(new AttemptService.Answer(List.of("choice"),"",List.of()));
        invalid.add(new AttemptService.Answer(List.of(),"text",List.of()));
        for(var answer:invalid) assertThrows(WorkspaceError.class,()->fixture.service.answer(student,3,7,fixture.session,new AttemptService.AnswerRequest("answer-key","open-id",answer)));
        verify(fixture.repository,never()).saveAnswer(any(),anyString(),anyString(),any(),any(),anyBoolean(),anyLong(),anyLong());
        var single=new ExamFixture(new AssessmentService.Question("SINGLE_CHOICE","Choose","EASY",BigDecimal.ONE,30,List.of(new AssessmentService.Option("Yes",true),new AssessmentService.Option("No",false)),List.of(),true,true,"",""));single.start();
        assertThrows(WorkspaceError.class,()->single.service.draft(student,3,7,single.session,new AttemptService.AnswerRequest("draft-key","open-id",new AttemptService.Answer(List.of(),"",List.of(first)))));
    }

    @Test void reviewReleasePolicyHidesBothCopiesOfSolutionsUntilDeadline() {
        var fixture=new ExamFixture(matching());fixture.start();
        var repository=mock(GradingRepository.class);var service=new GradingService(repository,json,mock(AssignmentService.class),mock(NotificationService.class),mock(WorkspaceAudit.class),CLOCK);
        when(repository.requireFinalizedStudentAttempt(1,3,2)).thenReturn(Map.of("assignment_id",4L,"student_review_allowed",true));
        var row=new LinkedHashMap<>(fixture.question);row.put("answer_json",json.write(new AttemptService.Answer(List.of(),"",fixture.solution().subList(0,1))));row.put("teacher_comment","Private comment");
        var snapshot=json.write(Map.of("questions",List.of(row)));
        when(repository.requireLatestRevision(1,3)).thenReturn(Map.of("snapshot_json",snapshot));
        when(repository.requireReleasePolicy(1,4)).thenReturn(Map.of("answers_after_deadline",true,"ends_at",NOW.plusSeconds(30)));
        var details=map(service.studentResult(student,3).get("details"));assertEquals(false,details.get("correctAnswersVisible"));
        var hidden=list(details.get("questions")).getFirst();var definition=json.object(hidden.get("definition_json"));
        assertFalse(definition.containsKey("matchingSolution"));assertEquals(List.of(),map(definition.get("question")).get("matchingPairs"));
        assertEquals(3,list(definition.get("matchingLeft")).size());assertEquals(3,list(definition.get("matchingRight")).size());
        assertNull(hidden.get("teacher_comment"));assertFalse(hidden.containsKey("draft_json"));assertNotNull(hidden.get("answer_json"));
        when(repository.requireReleasePolicy(1,4)).thenReturn(Map.of("answers_after_deadline",true,"ends_at",NOW));
        var released=map(service.studentResult(student,3).get("details"));assertEquals(true,released.get("correctAnswersVisible"));
        var releasedDefinition=json.object(list(released.get("questions")).getFirst().get("definition_json"));
        assertEquals(3,list(releasedDefinition.get("matchingSolution")).size());assertEquals(3,list(map(releasedDefinition.get("question")).get("matchingPairs")).size());
    }

    private class ExamFixture {
        final ExamAttemptRepository repository=mock(ExamAttemptRepository.class);
        final AttemptService service;
        final WorkspaceCrypto crypto=new WorkspaceCrypto();
        final AttemptService.Session session=new AttemptService.Session("a".repeat(43),"browser-key","authorization");
        final Map<String,Object> question=new LinkedHashMap<>(),attempt=new LinkedHashMap<>();
        ExamFixture(AssessmentService.Question definition) {
            var transactions=mock(TransactionTemplate.class);
            when(transactions.execute(any())).thenAnswer(call->{TransactionCallback<?> callback=call.getArgument(0);return callback.doInTransaction(mock(TransactionStatus.class));});
            service=new AttemptService(repository,json,CLOCK,crypto,mock(OrganizationService.class),mock(AssignmentService.class),mock(NotificationService.class),mock(CodeRateLimiter.class),transactions,mock(PasswordEncoder.class),mock(WorkspaceAudit.class),mock(ProfileExamMutex.class),false);
            attempt.putAll(Map.of("id",3L,"organization_id",1L,"assignment_id",4L,"student_id",2L,"current_position",0L,"status","in_progress","session_hash",crypto.hash(session.token()),"auth_session_hash",crypto.hash(session.authorization()),"browser_id",session.browserId()));
            question.putAll(Map.of("id",7L,"status","open","maximum_points",definition.points(),"time_seconds",60,"open_instance","open-id","opened_at",NOW,"deadline_at",NOW.plusSeconds(60)));
            when(repository.countStarts(anyLong(),anyLong(),anyLong(),anyString())).thenReturn(1L);
            when(repository.lockRecipient(1,4,2)).thenReturn(Map.of("max_attempts",1,"time_multiplier",BigDecimal.ONE));
            when(repository.findPreviousStartForUpdate(anyLong(),anyLong(),anyLong(),anyString())).thenReturn(Optional.empty());
            when(repository.lockAssignmentDefinition(1,4)).thenReturn(Map.of("starts_at",NOW.minusSeconds(1),"ends_at",NOW.plusSeconds(3600),"code_hash",crypto.hash("1:4:ABCD2345"),"definition_json",json.write(definition(definition))));
            when(repository.insertAttempt(anyLong(),anyLong(),anyLong(),anyLong(),anyString(),anyString(),anyString(),anyString(),anyString(),anyBoolean(),any())).thenReturn(3L);
            when(repository.insertQuestion(anyLong(),anyLong(),anyInt(),anyString(),any(),anyInt())).thenAnswer(call->{question.put("definition_json",call.getArgument(3));return 7L;});
            when(repository.lockAttempt(1,3)).thenReturn(attempt);
            when(repository.requireCurrentQuestion(eq(1L),eq(3L),anyLong())).thenReturn(question);
            when(repository.countQuestions(1,3)).thenReturn(1L);
            when(repository.requireAssignmentDeadline(1,4)).thenReturn(Map.of("ends_at",NOW.plusSeconds(3600)));
            when(repository.saveDraft(anyString(),eq(1L),eq(7L))).thenAnswer(call->{question.put("draft_json",call.getArgument(0));return 1;});
        }
        Map<String,Object> start() {return service.start(student,4,new AttemptService.StartRequest("ABCD2345","start-key",session.browserId(),session.token(),true,true,true),session.authorization(),"127.0.0.1");}
        List<AttemptService.Match> solution() {return list(json.object(question.get("definition_json")).get("matchingSolution")).stream().map(pair->new AttemptService.Match(pair.get("leftId").toString(),pair.get("rightId").toString())).toList();}
    }

    @SuppressWarnings("unchecked") private static Map<String,Object> map(Object value) {return (Map<String,Object>)value;}
    @SuppressWarnings("unchecked") private static List<Map<String,Object>> list(Object value) {return (List<Map<String,Object>>)value;}
    private static Map<String,String> index(List<Map<String,Object>> blocks) {Map<String,String> result=new HashMap<>();for(var block:blocks) result.put(block.get("id").toString(),block.get("text").toString());return result;}
}
