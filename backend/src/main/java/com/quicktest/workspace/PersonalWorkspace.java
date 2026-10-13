package com.quicktest.workspace;

import com.quicktest.workspace.repository.PersonalWorkspaceRepository;

import com.quicktest.auth.AppUser;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Clock;
import java.time.Instant;
import java.util.*;
import static com.quicktest.workspace.WorkspaceValues.*;

@Service
public class PersonalWorkspace {
    private final WorkspaceJson json;
    private final PersonalWorkspaceRepository repository;
    private final Clock clock;
    public PersonalWorkspace(PersonalWorkspaceRepository repository,WorkspaceJson json, Clock clock) {this.repository=repository;this.json=json;this.clock=clock;}

    // Existing composite foreign keys retain their namespace; accounts no longer select or join it.
    @Transactional
    public long workspace(AppUser user) {
        repository.lockUser(user.getId());
        var existing=repository.findPersonalWorkspace(user.getId());
        if(existing.isPresent()) return number(existing.get(),"organization_id");
        long id=repository.insertWorkspace(user.getName(), user.getEmail(), "Ученик / студент", json.write(Map.of("gradingScale","bulgarian","passThreshold",50)), clock.instant());
        repository.bindWorkspace(user.getId(), id);
        long plan=number(repository.requireStarterPlan(),"id");
        repository.insertSubscription(id, plan, Instant.parse("9999-01-01T00:00:00Z"), clock.instant());
        member(id,user.getId(),user.getRole().name());
        return id;
    }

    @Transactional
    public void member(long workspace,long user,String role) {
        repository.upsertMembership(workspace, user, json.write(List.of(role)), clock.instant());
    }
}
