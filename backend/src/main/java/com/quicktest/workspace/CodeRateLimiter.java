package com.quicktest.workspace;

import com.quicktest.workspace.repository.CodeRateLimitRepository;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import java.time.Clock;
import java.time.Duration;
import java.util.List;
import static com.quicktest.workspace.WorkspaceValues.*;

@Service
public class CodeRateLimiter {
    private final CodeRateLimitRepository repository;private final WorkspaceCrypto crypto;private final Clock clock;
    public CodeRateLimiter(CodeRateLimitRepository repository,WorkspaceCrypto crypto,Clock clock) {this.repository=repository;this.crypto=crypto;this.clock=clock;}
    @Transactional(propagation=Propagation.REQUIRES_NEW)
    public boolean check(long org,long assignment,long user,String ip,boolean correct) {
        List<String> keys=List.of("code:user:"+org+":"+assignment+":"+user,"code:ip:"+org+":"+assignment+":"+crypto.hash(ip));
        return checkBuckets(keys,correct);
    }
    @Transactional(propagation=Propagation.REQUIRES_NEW)
    public boolean checkGroupJoin(long user,String ip,boolean correct) {
        return checkBuckets(List.of("group-code:user:"+user,"group-code:ip:"+crypto.hash(ip)),correct);
    }
    @Transactional(propagation=Propagation.REQUIRES_NEW)
    public boolean checkAssignmentLookup(long user,String ip,boolean correct) {
        return checkBuckets(List.of("assignment-code-lookup:user:"+user,"assignment-code-lookup:ip:"+crypto.hash(ip)),correct);
    }
    private boolean checkBuckets(List<String> keys,boolean correct) {
        boolean allowed=true;
        for(String key:keys.stream().sorted().toList()) {
            // Acquire an exclusive lock directly; catching duplicate inserts leaves shared
            // index locks that can deadlock when concurrent callers upgrade to FOR UPDATE.
            repository.ensureBucket(key, clock.instant().plus(Duration.ofMinutes(5)));
            var bucket=repository.lockBucket(key);
            if(!clock.instant().isBefore(time(bucket,"expires_at"))) {repository.resetBucket(clock.instant().plus(Duration.ofMinutes(5)), key);bucket.put("failures",0);}
            if(number(bucket,"failures")>=5) allowed=false;
            if(!correct) repository.incrementFailures(key);
        }
        return allowed;
    }
    public WorkspaceError limited() {return new WorkspaceError(HttpStatus.TOO_MANY_REQUESTS,"rate_limit","Твърде много грешни кодове. Опитайте след 5 минути.");}
}
