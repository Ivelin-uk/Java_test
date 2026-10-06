package com.quicktest.workspace;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.http.HttpStatus;
import java.time.Clock;
import java.util.*;
import static com.quicktest.workspace.WorkspaceStore.*;

@Service
public class IdentityRateLimiter {
    private final WorkspaceStore db;private final WorkspaceCrypto crypto;private final Clock clock;
    public IdentityRateLimiter(WorkspaceStore db,WorkspaceCrypto crypto,Clock clock) {this.db=db;this.crypto=crypto;this.clock=clock;}
    @Transactional(propagation=Propagation.REQUIRES_NEW) public void check(String purpose,String identity,String ip) {
        List<String> buckets=new ArrayList<>(List.of("identity:"+purpose+":"+crypto.hash(Objects.toString(identity,"").strip().toLowerCase(Locale.ROOT)),"ip:"+purpose+":"+crypto.hash(ip)));Collections.sort(buckets);
        for(String bucket:buckets) {
            db.update("INSERT INTO workspace_rate_limits(bucket_key,failures,expires_at) VALUES(?,0,?) ON DUPLICATE KEY UPDATE bucket_key=bucket_key",bucket,clock.instant().plusSeconds(300));
            var row=db.one("SELECT * FROM workspace_rate_limits WHERE bucket_key=? FOR UPDATE",bucket);long count=clock.instant().isBefore(time(row,"expires_at"))?number(row,"failures"):0;
            if(count>=(bucket.startsWith("ip:")?60:20)) throw new WorkspaceError(HttpStatus.TOO_MANY_REQUESTS,"rate_limit","Твърде много заявки. Опитайте след 5 минути.");
            db.update("UPDATE workspace_rate_limits SET failures=?,expires_at=? WHERE bucket_key=?",count+1,count==0?clock.instant().plusSeconds(300):time(row,"expires_at"),bucket);
        }
    }
}
