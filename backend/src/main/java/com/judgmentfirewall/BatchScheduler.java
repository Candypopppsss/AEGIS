package com.judgmentfirewall;

import java.time.Instant;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class BatchScheduler {
    private final EventRepository events;
    private final FirewallService service;

    public BatchScheduler(EventRepository events, FirewallService service) {
        this.events = events;
        this.service = service;
    }

    @Scheduled(fixedDelay = 15000)
    public void release() {
        for (Long userId : events.dueUsers(Instant.now())) {
            service.releaseDue(userId);
        }
    }
}
