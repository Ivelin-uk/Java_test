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
    private final AssignmentDeletionService deletion;
    private final NotificationService notifications;

    public GroupAssignmentService(AssignmentRepository repository,WorkspaceJson json,WorkspaceAudit audit,Clock clock,AssignmentDeletionService deletion,NotificationService notifications) {
        this.repository=repository;this.json=json;this.audit=audit;this.clock=clock;
        this.deletion=deletion;this.notifications=notifications;
    }

    // The caller has authorized deletion and holds the group lock.
    @Transactional(propagation=Propagation.MANDATORY)
    public int removeGroup(long groupOrganization,long group,long actor) {
        int affected=0;
        for(var target:repository.findGroupAssignments(groupOrganization,group)) {
            long org=number(target,"organization_id"),id=number(target,"assignment_id");
            // Match membership updates and exam start: group -> recipients -> assignment -> attempts.
            var recipients=repository.lockRecipients(org,id);
            var found=repository.findAssignmentIfPresent(org,id,true);
            if(found.isEmpty()) continue;
            repository.deleteAssignmentGroup(org,id,groupOrganization,group);
            if(repository.findAssignmentGroups(org,id).isEmpty() && recipients.stream().noneMatch(row->flag(row,"individually_assigned"))) {
                deletion.removeLocked(org,found.get(),actor);
            } else {
                int removed=0;
                for(var recipient:recipients) {
                    var sources=new TreeSet<>(Arrays.asList(json.parse(recipient.get("source_groups_json"),Long[].class)));
                    if(!sources.remove(group)) continue;
                    long student=number(recipient,"student_id");
                    if(sources.isEmpty() && !flag(recipient,"individually_assigned")) {
                        deletion.removeRecipientLocked(org,id,student);removed++;
                    } else repository.updateRecipientSources(org,id,student,json.write(sources));
                }
                audit.write(org,actor,"assignment.group_deleted",id,Map.of("group",group,"groupOrganization",groupOrganization,"removedRecipients",removed));
            }
            affected++;
        }
        return affected;
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
            var assignmentDetails=repository.findAssignment(org,id,false);
            notifications.enqueueAssignment(org,student,string(repository.requireOrganizationName(org),"name"),string(assignmentDetails,"title"),id);
            audit.write(org,actor,"assignment.group_member_assigned",id,Map.of("student",student,"group",group));
        }
    }

    // Membership changes and assignment access are committed under the same group lock.
    @Transactional(propagation=Propagation.MANDATORY)
    public void removeMember(long groupOrganization,long group,long student,long actor) {
        for(var target:repository.findGroupAssignments(groupOrganization,group)) {
            long org=number(target,"organization_id"),id=number(target,"assignment_id");
            var recipients=repository.lockRecipients(org,id);
            if(repository.findAssignmentIfPresent(org,id,true).isEmpty()) continue;
            var recipient=recipients.stream().filter(row->number(row,"student_id")==student).findFirst();
            if(recipient.isEmpty() || flag(recipient.get(),"canceled") || flag(recipient.get(),"individually_assigned")) continue;
            if(!Arrays.asList(json.parse(recipient.get().get("source_groups_json"),Long[].class)).contains(group)) continue;
            Set<Long> groups=new TreeSet<>();
            for(var assigned:repository.findAssignmentGroups(org,id)) groups.add(number(assigned,"group_id"));
            if(!repository.findEligibleMembers(groups,student).isEmpty()) continue;
            String reason="Ученикът е премахнат от групата.";
            for(var attempt:repository.lockActiveStudentAttempts(org,id,student)) {
                long attemptId=number(attempt,"id");
                repository.voidAttempt(clock.instant(),reason,org,attemptId);
                audit.write(org,actor,"attempt.voided",attemptId,Map.of("reason",reason));
            }
            repository.cancelRecipient(org,id,student);
            audit.write(org,actor,"assignment.group_member_removed",id,Map.of("student",student,"group",group));
        }
    }
}
