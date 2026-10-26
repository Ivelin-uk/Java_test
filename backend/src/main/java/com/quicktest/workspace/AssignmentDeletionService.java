package com.quicktest.workspace;

import com.quicktest.workspace.repository.AssignmentRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;
import static com.quicktest.workspace.WorkspaceValues.*;

@Service
public class AssignmentDeletionService {
    private final AssignmentRepository repository;
    private final WorkspaceAudit audit;

    public AssignmentDeletionService(AssignmentRepository repository,WorkspaceAudit audit) {
        this.repository=repository;this.audit=audit;
    }

    // Callers authorize the operation and hold recipient -> assignment locks.
    @Transactional(propagation=Propagation.MANDATORY)
    public void removeLocked(long org,Map<String,Object> assignment,long actor) {
        long id=number(assignment,"id");
        if(repository.lockAssignmentNotifications(org,id).stream().anyMatch(n->string(n,"status").equals("processing"))) throw WorkspaceError.conflict("Изчакайте текущата доставка на известие и опитайте отново.");
        repository.deleteAssignmentNotifications(org,id);
        var attempts=repository.lockAttemptIds(org,id);
        removeAttempts(org,attempts);
        repository.deleteCodeDeliveries(org,id);
        repository.deleteSharedTeachers(org,id);
        repository.deleteRecipients(org,id);
        repository.deleteAssignment(org,id);
        audit.write(org,actor,"assignment.deleted",id,Map.of("attempts",attempts.size(),"version",number(assignment,"version_id")));
    }

    @Transactional(propagation=Propagation.MANDATORY)
    public void removeRecipientLocked(long org,long assignment,long student) {
        if(repository.lockRecipientAssignmentNotifications(org,assignment,student).stream().anyMatch(n->string(n,"status").equals("processing"))) throw WorkspaceError.conflict("Изчакайте текущата доставка на известие и опитайте отново.");
        repository.deleteRecipientAssignmentNotifications(org,assignment,student);
        removeAttempts(org,repository.lockStudentAttempts(org,assignment,student));
        repository.deleteRecipientCodeDeliveries(org,assignment,student);
        repository.deleteRecipient(org,assignment,student);
    }

    private void removeAttempts(long org,List<Map<String,Object>> attempts) {
        for(var attempt:attempts) {
            long id=number(attempt,"id");
            var deliveries=repository.lockResultDeliveries(org,id);
            if(deliveries.stream().anyMatch(n->string(n,"status").equals("processing"))) throw WorkspaceError.conflict("Изчакайте текущата доставка на резултат и опитайте отново.");
            repository.deleteResultDeliveries(org,org,id);
            repository.deleteEvents(org,id);
            repository.deleteResults(org,id);
            repository.deleteQuestions(org,id);
            repository.deleteAttempt(org,id);
        }
    }
}
