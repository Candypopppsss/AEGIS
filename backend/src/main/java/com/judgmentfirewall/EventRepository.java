package com.judgmentfirewall;

import java.time.Instant;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface EventRepository extends JpaRepository<DecisionEvent, Long> {
    List<DecisionEvent> findByUserIdAndOccurredAtGreaterThanEqualAndOccurredAtLessThanOrderByOccurredAtDesc(
        Long id, Instant start, Instant end);

    List<DecisionEvent> findByUserIdAndAccountedAtGreaterThanEqualAndAccountedAtLessThan(
        Long id, Instant start, Instant end);

    List<DecisionEvent> findByUserIdAndAccountedAtIsNull(Long id);

    @Query("select distinct e.user.id from DecisionEvent e where e.accountedAt is null and e.holdUntil <= :now")
    List<Long> dueUsers(Instant now);
}
