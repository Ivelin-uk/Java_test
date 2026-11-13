package com.quicktest;

import com.quicktest.ai.MockAiProvider;
import com.quicktest.workspace.*;
import com.quicktest.workspace.repository.AssessmentRepository;
import com.quicktest.workspace.repository.WorkspaceAiRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class MatchingAiGenerationTests {
    @Test
    void matchingGenerationCanBeQueuedAndKeepsPairsWhenIllustrated() {
        var json = new WorkspaceJson(new ObjectMapper());
        var clock = Clock.fixed(Instant.parse("2026-11-13T08:00:00Z"), ZoneOffset.UTC);
        var repository = mock(WorkspaceAiRepository.class);
        var organizations = mock(OrganizationService.class);
        var entitlements = mock(TeacherEntitlementService.class);
        var images = mock(PrivateImageService.class);
        var assessments = new AssessmentService(mock(AssessmentRepository.class), json, mock(WorkspaceAudit.class),
                clock, images, mock(PersonalWorkspace.class), mock(WorkspaceCrypto.class));
        var manager = mock(PlatformTransactionManager.class);
        when(manager.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        var service = new WorkspaceAiService(repository, json, new MockAiProvider(), organizations, assessments,
                new TransactionTemplate(manager), clock, images, entitlements, true);
        var scope = new OrgAccess.Scope(3, 7, Set.of("TEACHER"));
        var request = new WorkspaceAiService.Generate("matching-ai-example", "Основи на Java", "Информатика", "12", "bg",
                1, "MEDIUM", null, List.of("MATCHING"), Map.of("MEDIUM", 1), null, 1);
        when(entitlements.applies(scope)).thenReturn(true);
        when(repository.findPreviousJob(3, 7, request.requestKey())).thenReturn(Optional.empty());
        when(repository.insertJob(eq(3L), eq(7L), eq(request.requestKey()), anyString(), any(), any())).thenReturn(11L);
        when(repository.requireOwnedJob(3, 7, 11)).thenReturn(Map.of("id", 11));
        assertEquals(11, service.enqueue(scope, request).get("id"));
        verify(entitlements).reserveAi(scope, "generation", 11);

        var queued = Map.<String, Object>of("organization_id", 3, "id", 11, "user_id", 7,
                "attempts", 0, "request_json", json.write(request));
        when(repository.findNextJobForUpdate()).thenReturn(Optional.of(queued));
        when(repository.lockJob(3, 11)).thenReturn(Map.of("status", "running", "attempts", 1));
        when(repository.heartbeat(any(), eq(3L), eq(11L), eq(1L))).thenReturn(1);
        when(images.upload(any(), any())).thenReturn(Map.of("id", 77));
        when(entitlements.settleAi("generation", 11, true)).thenReturn(true);
        service.process();

        var result = ArgumentCaptor.forClass(String.class);
        verify(repository).completeJob(eq("completed"), result.capture(), isNull(), eq(clock.instant()), eq(3L), eq(11L));
        var definition = json.parse(json.write(json.object(result.getValue()).get("definition")), AssessmentService.Definition.class);
        var question = definition.questions().getFirst();
        assertEquals("MATCHING", question.type());
        assertEquals(77L, question.imageId());
        assertTrue(question.options().isEmpty());
        assertTrue(question.acceptedAnswers().isEmpty());
        assertEquals(3, question.matchingPairs().size());
        assertEquals("Клас", question.matchingPairs().getFirst().left());
        assessments.validate(definition);
    }
}
