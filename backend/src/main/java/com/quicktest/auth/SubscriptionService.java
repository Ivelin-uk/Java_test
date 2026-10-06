package com.quicktest.auth;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;

@Service
public class SubscriptionService {
    private final ZoneId zone;

    public SubscriptionService(@Value("${app.subscription-zone:Europe/Sofia}") String zone) {
        this.zone = ZoneId.of(zone);
    }

    public Status status(AppUser user) {
        boolean active = user.isSubscriptionPaid() && user.getSubscriptionPaidUntil() != null
                && !user.getSubscriptionPaidUntil().isBefore(LocalDate.now(zone));
        return new Status(user.isSubscriptionPaid(), user.getSubscriptionPaidUntil(), user.getSubscriptionPaidAt(), active);
    }

    public record Status(boolean paid, LocalDate paidUntil, Instant paidAt, boolean active) {}
}
