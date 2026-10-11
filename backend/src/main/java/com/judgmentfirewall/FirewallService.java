package com.judgmentfirewall;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
@Transactional
public class FirewallService {
    private static final Duration PREPARATION = Duration.ofMinutes(15);
    private final UserRepository users;
    private final ZoneRepository zones;
    private final EventRepository events;
    private final BatteryRepository batteries;

    public FirewallService(UserRepository users, ZoneRepository zones,
                           EventRepository events, BatteryRepository batteries) {
        this.users = users;
        this.zones = zones;
        this.events = events;
        this.batteries = batteries;
    }

    private User lockUser(Long id) {
        return users.lockById(id)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED));
    }

    public static int weight(DecisionEvent.Type type) {
        return switch (type) {
            case NOTIFICATION -> 1;
            case APP_SWITCH -> 2;
            case MESSAGE_REPLY -> 3;
            case FORM_INPUT -> 4;
        };
    }

    private void releaseBatches(User user, Instant now) {
        Map<Long, List<DecisionEvent>> batches = new HashMap<>();
        for (var event : events.findByUserIdAndAccountedAtIsNull(user.id)) {
            if (!event.holdUntil.isAfter(now)) {
                batches.computeIfAbsent(event.zone.id, id -> new ArrayList<>()).add(event);
            }
        }
        if (batches.isEmpty()) return;

        var releaseDates = new HashSet<LocalDate>();
        for (var batch : batches.values()) {
            batch.sort(Comparator.comparing(event -> event.id));
            for (var event : batch) {
                event.accountedAt = event.holdUntil;
                event.chargedWeight = 0;
            }
            // Charge once per batch, on the day its zone ended.
            var first = batch.get(0);
            first.chargedWeight = batch.stream().mapToInt(event -> event.weight).max().orElse(0);
            releaseDates.add(first.accountedAt.atZone(ZoneId.of(user.timezone)).toLocalDate());
        }
        events.flush();
        for (var date : releaseDates) updateBattery(user, date);
    }

    public void releaseDue(Long id) {
        releaseBatches(lockUser(id), Instant.now());
    }

    private DailyBattery updateBattery(User user, LocalDate date) {
        var timezone = ZoneId.of(user.timezone);
        var start = date.atStartOfDay(timezone).toInstant();
        var end = date.plusDays(1).atStartOfDay(timezone).toInstant();
        var battery = batteries.findByUserIdAndBatteryDate(user.id, date).orElseGet(() -> {
            var record = new DailyBattery();
            record.user = user;
            record.batteryDate = date;
            return record;
        });
        int cost = events.findByUserIdAndAccountedAtGreaterThanEqualAndAccountedAtLessThan(user.id, start, end)
            .stream().mapToInt(event -> event.chargedWeight).sum();
        battery.currentCapacity = Math.max(0, battery.startCapacity - cost);
        battery.updatedAt = Instant.now();
        return batteries.save(battery);
    }

    public Map<String, Object> dashboard(Long id, LocalDate requestedDate) {
        var user = lockUser(id);
        releaseBatches(user, Instant.now());
        var timezone = ZoneId.of(user.timezone);
        var date = requestedDate == null ? LocalDate.now(timezone) : requestedDate;
        var start = date.atStartOfDay(timezone).toInstant();
        var end = date.plusDays(1).atStartOfDay(timezone).toInstant();
        var dayEvents = events.findByUserIdAndOccurredAtGreaterThanEqualAndOccurredAtLessThanOrderByOccurredAtDesc(id, start, end);
        var appliedEvents = events.findByUserIdAndAccountedAtGreaterThanEqualAndAccountedAtLessThan(id, start, end);
        var summary = new LinkedHashMap<String, Integer>();
        for (var type : DecisionEvent.Type.values()) {
            int cost = appliedEvents.stream().filter(event -> event.eventType == type)
                .mapToInt(event -> event.chargedWeight).sum();
            summary.put(type.name(), cost);
        }

        return Map.of(
            "user", Map.of("fullName", user.fullName, "email", user.email, "timezone", user.timezone),
            "date", date,
            "capacity", updateBattery(user, date).currentCapacity,
            "events", dayEvents.stream().map(this::eventView).toList(),
            "zones", zones.findByUserIdOrderByStartsAtAsc(id).stream()
                .filter(zone -> !zone.endsAt.isBefore(start)).map(this::zoneView).toList(),
            "summary", summary,
            "heldCount", events.findByUserIdAndAccountedAtIsNull(id).size()
        );
    }

    private Map<String, Object> eventView(DecisionEvent event) {
        String status = event.accountedAt == null ? "HELD" : event.batched ? "RELEASED" : "APPLIED";
        return Map.of(
            "id", event.id, "eventType", event.eventType, "weight", event.weight,
            "chargedWeight", event.chargedWeight, "occurredAt", event.occurredAt, "status", status
        );
    }

    private Map<String, Object> zoneView(ProtectZone zone) {
        return Map.of("id", zone.id, "title", zone.title, "startsAt", zone.startsAt, "endsAt", zone.endsAt);
    }

    public void addEvent(Long id, DecisionEvent.Type type) {
        var user = lockUser(id);
        var now = Instant.now();
        releaseBatches(user, now);
        var event = new DecisionEvent();
        event.user = user;
        event.eventType = type;
        event.weight = weight(type);
        event.occurredAt = now;

        if (type == DecisionEvent.Type.NOTIFICATION) {
            var zone = zones.findByUserIdOrderByStartsAtAsc(id).stream()
                .filter(item -> !now.isBefore(item.startsAt.minus(PREPARATION)) && now.isBefore(item.endsAt))
                .findFirst();
            if (zone.isPresent()) {
                event.batched = true;
                event.zone = zone.get();
                event.holdUntil = event.zone.endsAt;
            }
        }
        if (!event.batched) {
            event.chargedWeight = event.weight;
            event.accountedAt = now;
        }
        events.saveAndFlush(event);
        updateBattery(user, LocalDate.now(ZoneId.of(user.timezone)));
    }

    public void addZone(Long id, String title, Instant start, Instant end) {
        var user = lockUser(id);
        if (!start.isBefore(end) || !end.isAfter(Instant.now())
            || Duration.between(start, end).compareTo(Duration.ofHours(24)) > 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                "The zone must end in the future and last no more than 24 hours.");
        }
        boolean overlap = zones.findByUserIdOrderByStartsAtAsc(id).stream().anyMatch(zone ->
            start.minus(PREPARATION).isBefore(zone.endsAt) && end.isAfter(zone.startsAt.minus(PREPARATION)));
        if (overlap) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Leave at least 15 minutes between zones.");
        }
        var zone = new ProtectZone();
        zone.user = user;
        zone.title = title.strip();
        zone.startsAt = start;
        zone.endsAt = end;
        zones.save(zone);
    }

    public void deleteZone(Long id, Long zoneId) {
        lockUser(id);
        var zone = zones.findById(zoneId).filter(item -> item.user.id.equals(id))
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Zone not found."));
        if (!Instant.now().isBefore(zone.startsAt.minus(PREPARATION))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "This zone has already started its preparation period.");
        }
        zones.delete(zone);
    }
}
