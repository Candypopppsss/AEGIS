package com.judgmentfirewall;

import java.time.Instant;
import jakarta.persistence.*;

@Entity
@Table(name = "decision_events")
public class DecisionEvent {
    public enum Type { NOTIFICATION, APP_SWITCH, MESSAGE_REPLY, FORM_INPUT }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @ManyToOne(optional = false)
    public User user;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    public Type eventType;

    public int weight;
    public int chargedWeight;
    public boolean batched;
    public Instant occurredAt;
    public Instant accountedAt;
    public Instant holdUntil;

    @ManyToOne
    public ProtectZone zone;
}
