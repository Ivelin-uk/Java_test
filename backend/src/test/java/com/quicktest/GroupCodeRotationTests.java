package com.quicktest;

import com.quicktest.workspace.*;
import com.quicktest.workspace.repository.OrganizationRepository;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import java.time.Clock;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class GroupCodeRotationTests {
    @Test void aCodeReplacedBetweenLookupAndLockCannotEnrollAStudent() {
        var repository=mock(OrganizationRepository.class);var limiter=mock(CodeRateLimiter.class);
        var personal=mock(PersonalWorkspace.class);var audit=mock(WorkspaceAudit.class);
        var service=new OrganizationService(repository,mock(WorkspaceJson.class),new WorkspaceCrypto(),audit,mock(NotificationService.class),Clock.systemUTC(),personal,limiter,mock(com.quicktest.workspace.GroupAssignmentService.class));
        when(repository.findGroupByJoinCode("ABCD2345")).thenReturn(Optional.of(Map.of("id",10L,"organization_id",20L,"name","Group")));
        when(limiter.checkGroupJoin(30L,"rotation-race",true)).thenReturn(true);
        when(repository.lockGroup(20L,10L)).thenReturn(Map.of("id",10L,"join_code","EFGH6789"));
        var error=assertThrows(WorkspaceError.class,()->service.joinGroup(new OrgAccess.Scope(40L,30L,Set.of("STUDENT"),true),"ABCD2345","rotation-race"));
        assertEquals(HttpStatus.BAD_REQUEST,error.getStatusCode());
        verify(personal,never()).member(anyLong(),anyLong(),anyString());
        verify(repository,never()).upsertGroupMember(anyLong(),anyLong(),anyLong());
        verifyNoInteractions(audit);
    }
}
