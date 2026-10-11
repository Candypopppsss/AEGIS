package com.judgmentfirewall;

import java.time.Instant;
import jakarta.persistence.*;

@Entity
@Table(name = "protect_zones")
public class ProtectZone {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @ManyToOne(optional = false)
    public User user;

    @Column(nullable = false)
    public String title;

    @Column(nullable = false)
    public Instant startsAt;

    @Column(nullable = false)
    public Instant endsAt;
}
