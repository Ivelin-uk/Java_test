package com.quicktest.workspace;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import java.time.Clock;
import java.time.Duration;
import java.util.List;
import static com.quicktest.workspace.WorkspaceStore.*;

@Service
public class CodeRateLimiter {
    private final WorkspaceStore db;private final WorkspaceCrypto crypto;private final Clock clock;
    public CodeRateLimiter(WorkspaceStore db,WorkspaceCrypto crypto,Clock clock) {this.db=db;this.crypto=crypto;this.clock=clock;}
    @Transactional(propagation=Propagation.REQUIRES_NEW)
    public boolean check(long org,long assignment,long user,String ip,boolean correct) {
        List<String> keys=List.of("code:user:"+org+":"+assignment+":"+user,"code:ip:"+org+":"+assignment+":"+crypto.hash(ip));
        boolean allowed=true;
        for(String key:keys.stream().sorted().toList()) {
            // Acquire an exclusive lock directly; catching duplicate inserts leaves shared
            // index locks that can deadlock when concurrent callers upgrade to FOR UPDATE.
            db.update("INSERT INTO workspace_rate_limits(bucket_key,failures,expires_at) VALUES(?,0,?) ON DUPLICATE KEY UPDATE bucket_key=VALUES(bucket_key)",key,clock.instant().plus(Duration.ofMinutes(5)));
            var bucket=db.one("SELECT * FROM workspace_rate_limits WHERE bucket_key=? FOR UPDATE",key);
            if(!clock.instant().isBefore(time(bucket,"expires_at"))) {db.update("UPDATE workspace_rate_limits SET failures=0,expires_at=? WHERE bucket_key=?",clock.instant().plus(Duration.ofMinutes(5)),key);bucket.put("failures",0);}
            if(number(bucket,"failures")>=5) allowed=false;
            if(!correct) db.update("UPDATE workspace_rate_limits SET failures=failures+1 WHERE bucket_key=?",key);
        }
        return allowed;
    }
    public WorkspaceError limited() {return new WorkspaceError(HttpStatus.TOO_MANY_REQUESTS,"rate_limit","Твърде много грешни кодове. Опитайте след 5 минути.");}
}
