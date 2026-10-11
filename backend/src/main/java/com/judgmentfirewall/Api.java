package com.judgmentfirewall;

import java.nio.charset.StandardCharsets;
import java.time.DateTimeException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Locale;
import java.util.Map;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api")
public class Api {
    private final UserRepository users;
    private final PasswordEncoder passwords;
    private final JwtEncoder encoder;
    private final FirewallService service;

    public Api(UserRepository users, PasswordEncoder passwords, JwtEncoder encoder, FirewallService service) {
        this.users = users;
        this.passwords = passwords;
        this.encoder = encoder;
        this.service = service;
    }

    record Register(
        @NotBlank @Size(max = 100) String fullName,
        @NotBlank @Email @Size(max = 254) String email,
        @NotBlank @Size(min = 10, max = 72) String password,
        @NotBlank String timezone
    ) {}

    record Login(@NotBlank @Email String email, @NotBlank @Size(max = 72) String password) {}
    record EventInput(@NotNull DecisionEvent.Type eventType) {}
    record ZoneInput(@NotBlank @Size(max = 120) String title, @NotNull Instant startsAt, @NotNull Instant endsAt) {}

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of("status", "ok");
    }

    @PostMapping("/auth/register")
    public Map<String, String> register(@Valid @RequestBody Register input) {
        try {
            ZoneId.of(input.timezone());
        } catch (DateTimeException error) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid timezone.");
        }
        if (input.password().getBytes(StandardCharsets.UTF_8).length > 72) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Password must be at most 72 UTF-8 bytes.");
        }
        var user = new User();
        user.fullName = input.fullName().strip();
        user.email = input.email().strip().toLowerCase(Locale.ROOT);
        user.passwordHash = passwords.encode(input.password());
        user.timezone = input.timezone();
        try {
            users.saveAndFlush(user);
        } catch (DataIntegrityViolationException error) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "An account with this email already exists.");
        }
        return Map.of("token", Security.token(encoder, user));
    }

    @PostMapping("/auth/login")
    public Map<String, String> login(@Valid @RequestBody Login input) {
        if (input.password().getBytes(StandardCharsets.UTF_8).length > 72) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Email or password is incorrect.");
        }
        var user = users.findByEmail(input.email().strip().toLowerCase(Locale.ROOT))
            .filter(item -> passwords.matches(input.password(), item.passwordHash))
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Email or password is incorrect."));
        return Map.of("token", Security.token(encoder, user));
    }

    @GetMapping("/dashboard")
    public Map<String, Object> dashboard(@AuthenticationPrincipal Jwt jwt,
                                        @RequestParam(required = false) LocalDate date) {
        return service.dashboard(Long.valueOf(jwt.getSubject()), date);
    }

    @PostMapping("/events")
    public Map<String, Object> event(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody EventInput input) {
        var userId = Long.valueOf(jwt.getSubject());
        service.addEvent(userId, input.eventType());
        return service.dashboard(userId, null);
    }

    @PostMapping("/zones")
    public Map<String, Object> zone(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody ZoneInput input) {
        var userId = Long.valueOf(jwt.getSubject());
        service.addZone(userId, input.title(), input.startsAt(), input.endsAt());
        return service.dashboard(userId, null);
    }

    @DeleteMapping("/zones/{zoneId}")
    public Map<String, Object> delete(@AuthenticationPrincipal Jwt jwt, @PathVariable Long zoneId) {
        var userId = Long.valueOf(jwt.getSubject());
        service.deleteZone(userId, zoneId);
        return service.dashboard(userId, null);
    }
}
