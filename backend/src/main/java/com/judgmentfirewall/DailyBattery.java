package com.judgmentfirewall;

import java.time.Instant;
import java.time.LocalDate;
import jakarta.persistence.*;

@Entity
@Table(name = "daily_battery", uniqueConstraints = @UniqueConstraint(columnNames = {"user_id", "battery_date"}))
public class DailyBattery {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @ManyToOne(optional = false)
    public User user;

    @Column(name = "battery_date", nullable = false)
    public LocalDate batteryDate;

    public int startCapacity = 100;
    public int currentCapacity = 100;
    public Instant updatedAt;
}
