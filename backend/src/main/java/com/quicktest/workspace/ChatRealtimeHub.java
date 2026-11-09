package com.quicktest.workspace;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.BiPredicate;
import java.util.function.BooleanSupplier;

/** Transient invalidations only; the database remains the source of message history. */
@Component
public class ChatRealtimeHub {
    private static final int MAX_STREAMS = 1024;
    private static final int MAX_USER_STREAMS = 4;
    private final ConcurrentHashMap<SseEmitter, Subscription> streams = new ConcurrentHashMap<>();

    public synchronized SseEmitter subscribe(long organizationId, long userId, Long conversationId, boolean platform,
                                              BooleanSupplier authorized, BiPredicate<Long, Long> canReceive) {
        var existing = streams.entrySet().stream().filter(entry -> entry.getValue().userId() == userId).toList();
        if (existing.size() >= MAX_USER_STREAMS) close(existing.getFirst().getKey());
        if (streams.size() >= MAX_STREAMS) {
            throw new WorkspaceError(org.springframework.http.HttpStatus.TOO_MANY_REQUESTS, "rate_limit", "Твърде много активни връзки. Опитайте отново след малко.");
        }
        SseEmitter emitter = new SseEmitter(15 * 60 * 1000L);
        streams.put(emitter, new Subscription(organizationId, userId, conversationId, platform, authorized, canReceive));
        emitter.onCompletion(() -> streams.remove(emitter));
        emitter.onTimeout(() -> close(emitter));
        emitter.onError(ignored -> streams.remove(emitter));
        send(emitter, SseEmitter.event().name("ready").reconnectTime(1000).data(Map.of("connected", true)));
        return emitter;
    }

    public void publish(long organizationId, long conversationId, long messageId) {
        broadcast(organizationId, conversationId, messageId, null);
    }

    public void read(long organizationId, long conversationId, long userId) {
        broadcast(organizationId, conversationId, null, userId);
    }

    private void broadcast(long organizationId, long conversationId, Long messageId, Long recipient) {
        streams.forEach((emitter, subscription) -> {
            if (!valid(subscription)) { close(emitter); return; }
            if ((!subscription.platform() && subscription.organizationId() != organizationId)
                    || (recipient != null && subscription.userId() != recipient)
                    || (subscription.conversationId() != null && subscription.conversationId() != conversationId)) return;
            try {
                if (!subscription.canReceive().test(organizationId, conversationId)) return;
                if (subscription.conversationId() == null) {
                    send(emitter, SseEmitter.event().name("changed").data(Map.of("conversationId", conversationId)));
                } else if (messageId != null) {
                    send(emitter, SseEmitter.event().name("message").id(Long.toString(messageId)).data(messageId));
                }
            } catch (RuntimeException unavailable) {
                close(emitter);
            }
        });
    }

    @Scheduled(fixedDelay = 15_000)
    public void keepAlive() {
        streams.forEach((emitter, subscription) -> {
            if (!valid(subscription)) close(emitter);
            else send(emitter, SseEmitter.event().comment("keepalive"));
        });
    }

    private boolean valid(Subscription subscription) {
        try { return subscription.authorized().getAsBoolean(); }
        catch (RuntimeException denied) { return false; }
    }

    private void send(SseEmitter emitter, SseEmitter.SseEventBuilder event) {
        try { emitter.send(event); }
        catch (IOException | IllegalStateException disconnected) { close(emitter); }
    }

    private void close(SseEmitter emitter) {
        if (streams.remove(emitter) != null) emitter.complete();
    }

    int subscriptionCount() { return streams.size(); }

    private record Subscription(long organizationId, long userId, Long conversationId, boolean platform,
                                BooleanSupplier authorized, BiPredicate<Long, Long> canReceive) {}
}
