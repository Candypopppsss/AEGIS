package com.judgmentfirewall;

import java.time.LocalDate;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface BatteryRepository extends JpaRepository<DailyBattery, Long> {
    Optional<DailyBattery> findByUserIdAndBatteryDate(Long id, LocalDate date);
}
