package com.quicktest.workspace;

import com.quicktest.workspace.repository.AssignmentRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import java.time.Clock;
import java.util.*;
import static com.quicktest.workspace.WorkspaceValues.*;

@Service
public class GroupAssignmentService {
    private final AssignmentRepository repository;
    private final WorkspaceJson json;
    private final WorkspaceAudit audit;
    private final Clock clock;

    public GroupAssignmentService(AssignmentRepository repository,WorkspaceJson json,WorkspaceAudit audit,Clock clock) {
        this.repository=repository;this.json=json;this.audit=audit;this.clock=clock;
    }

    // The caller holds the group lock in the same membership transaction.
    @Transactional(propagation=Propagation.MANDATORY)
    public void addMember(long groupOrganization,long group,long student,long actor) {
        if(repository.findEligibleMembers(Set.of(group),student).isEmpty()) throw WorkspaceError.forbidden();
        for(var target:repository.findGroupAssignments(groupOrganization,group)) {
            long org=number(target,"organization_id"),id=number(target,"assignment_id");
            // A platform assignment may target a group in another workspace. Add only
            // a missing namespace membership; never reactivate or overwrite an existing one.
            repository.ensureRecipientMembership(org,student,json.write(List.of("STUDENT")),clock.instant());
            if(!repository.hasActiveStudentMembership(org,student)) continue;
            var recipients=repository.lockRecipients(org,id);
            var found=repository.findAssignmentIfPresent(org,id,true);
            if(found.isEmpty()) continue;
            var assignment=found.get();
            Set<Long> assignedGroups=new LinkedHashSet<>();
            for(var source:repository.findAssignmentGroups(org,id)) assignedGroups.add(number(source,"group_id"));
            var sources=repository.findEligibleMembers(assignedGroups,student).stream().map(row->number(row,"group_id")).distinct().sorted().toList();
            if(!sources.contains(group)) continue;
            var previous=recipients.stream().filter(row->number(row,"student_id")==student).findFirst();
            if(previous.isPresent()) {
                var row=previous.get();
                Set<Long> combined=new TreeSet<>(Arrays.asList(json.parse(row.get("source_groups_json"),Long[].class)));
                if(combined.addAll(sources)) repository.updateRecipientSources(org,id,student,json.write(combined));
                // Existing cancellations, accommodations, attempt limits and results stay intact.
                continue;
            }
            repository.insertRecipient(org,id,student,json.write(sources),number(assignment,"max_attempts"));
            audit.write(org,actor,"assignment.group_member_assigned",id,Map.of("student",student,"group",group));
        }
    }
}
