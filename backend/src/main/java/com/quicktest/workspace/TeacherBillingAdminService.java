package com.quicktest.workspace;

import com.quicktest.workspace.repository.TeacherBillingRepository;
import org.springframework.stereotype.Service;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import static com.quicktest.workspace.WorkspaceValues.*;

@Service
public class TeacherBillingAdminService {
    private final TeacherBillingRepository repository;
    private final PaymentGateway gateway;
    private final Clock clock;

    public TeacherBillingAdminService(TeacherBillingRepository repository,PaymentGateway gateway,Clock clock) {
        this.repository=repository;this.gateway=gateway;this.clock=clock;
    }

    public List<TeacherPlan> plans() {
        return repository.findTeacherPlansForAdmin().stream().map(row -> {
            boolean sameMode=string(row,"stripe_mode").equals(gateway.mode());
            String period=sameMode?string(row,"billing_period"):"";
            boolean active=sameMode && row.get("paid_through")!=null && time(row,"paid_through").isAfter(clock.instant());
            Long amount=period.equals("month")?Long.valueOf(700):period.equals("year")?Long.valueOf(5000):null;
            return new TeacherPlan(number(row,"user_id"),active?"pro":"free",
                    string(row,"provider_status").isBlank()?"free":string(row,"provider_status"),
                    period.isBlank()?null:period,amount,amount==null?null:"EUR",
                    row.get("paid_through")==null?null:time(row,"paid_through"),flag(row,"cancel_at_period_end"));
        }).toList();
    }

    public record TeacherPlan(long userId,String plan,String status,String period,Long amountMinor,
                              String currency,Instant paidThrough,boolean cancelAtPeriodEnd) {}
}
