package com.judgmentfirewall;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ZoneRepository extends JpaRepository<ProtectZone, Long> {
    List<ProtectZone> findByUserIdOrderByStartsAtAsc(Long id);
}
