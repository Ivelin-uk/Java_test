package com.quicktest.workspace;

import com.quicktest.workspace.repository.IdentityRateLimitRepository;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.http.HttpStatus;
import java.time.Clock;
import java.util.*;
import static com.quicktest.workspace.WorkspaceValues.*;

@Service
public class IdentityRateLimiter {
    private final IdentityRateLimitRepository repository;private final WorkspaceCrypto crypto;private final Clock clock;
    public IdentityRateLimiter(IdentityRateLimitRepository repository,WorkspaceCrypto crypto,Clock clock) {this.repository=repository;this.crypto=crypto;this.clock=clock;}
    @Transactional(propagation=Propagation.REQUIRES_NEW) public void check(String purpose,String identity,String ip) {
        List<String> buckets=new ArrayList<>(List.of("identity:"+purpose+":"+crypto.hash(Objects.toString(identity,"").strip().toLowerCase(Locale.ROOT)),"ip:"+purpose+":"+crypto.hash(ip)));Collections.sort(buckets);
        for(String bucket:buckets) {
            repository.ensureBucket(bucket, clock.instant().plusSeconds(300));
            var row=repository.lockBucket(bucket);long count=clock.instant().isBefore(time(row,"expires_at"))?number(row,"failures"):0;
            if(count>=(bucket.startsWith("ip:")?60:20)) throw new WorkspaceError(HttpStatus.TOO_MANY_REQUESTS,"rate_limit","Твърде много заявки. Опитайте след 5 минути.");
            repository.updateBucket(count+1, count==0?clock.instant().plusSeconds(300):time(row,"expires_at"), bucket);
        }
    }
}
