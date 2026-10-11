package com.judgmentfirewall;
import java.time.*;
import java.util.*;
import com.fasterxml.jackson.databind.*;
import org.junit.jupiter.api.*;
import static org.junit.jupiter.api.Assertions.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import org.springframework.http.MediaType;
@SpringBootTest(properties= {
    "spring.datasource.url=jdbc:h2:mem:firewall;MODE=PostgreSQL;DB_CLOSE_DELAY=-1"
}
)
@ActiveProfiles("dev") @AutoConfigureMockMvc
class ApiIntegrationTest  {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired EventRepository events;
    String register() throws Exception  {
        var body=Map.of("fullName","Test User","email",UUID.randomUUID()+"@college.edu","password","test-password-123","timezone","Asia/Kolkata");
        var response=mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body))).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return json.readTree(response).get("token").asText();
    }
    JsonNode dashboard(String token) throws Exception  {
        return json.readTree(mvc.perform(get("/api/dashboard").header("Authorization","Bearer "+token)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }
    JsonNode event(String token,String type) throws Exception  {
        return json.readTree(mvc.perform(post("/api/events").header("Authorization","Bearer "+token).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(Map.of("eventType",type)))).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }
    void zone(String token,Instant start,Instant end,int expected) throws Exception  {
        mvc.perform(post("/api/zones").header("Authorization","Bearer "+token).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(Map.of("title","Exam","startsAt",start.toString(),"endsAt",end.toString())))).andExpect(status().is(expected));
    }
    @Test void authenticationRequired() throws Exception  {
        mvc.perform(get("/api/dashboard")).andExpect(status().isUnauthorized());
    }
    @Test void developmentCorsAllowsBothLocalAddresses() throws Exception {
        for (String origin : List.of("http://localhost:5173", "http://127.0.0.1:5173")) {
            mvc.perform(options("/api/events").header("Origin", origin)
                .header("Access-Control-Request-Method", "POST")
                .header("Access-Control-Request-Headers", "Authorization,Content-Type"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", origin));
        }
        mvc.perform(options("/api/events").header("Origin", "https://untrusted.example")
            .header("Access-Control-Request-Method", "POST"))
            .andExpect(status().isForbidden());
    }
    @Test void malformedInputIsRejected() throws Exception {
        String token = register();
        mvc.perform(post("/api/events").header("Authorization", "Bearer " + token)
            .contentType(MediaType.APPLICATION_JSON).content("{\"eventType\":\"UNKNOWN\"}"))
            .andExpect(status().isBadRequest());
        mvc.perform(post("/api/zones").header("Authorization", "Bearer " + token)
            .contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isBadRequest());
        mvc.perform(get("/api/dashboard").header("Authorization", "Bearer invalid-token"))
            .andExpect(status().isUnauthorized());
    }

    @Test void usersCannotDeleteAnotherUsersZone() throws Exception {
        String owner = register();
        String otherUser = register();
        var start = Instant.now().plusSeconds(3600);
        zone(owner, start, start.plusSeconds(1800), 200);
        long zoneId = dashboard(owner).get("zones").get(0).get("id").asLong();
        mvc.perform(delete("/api/zones/" + zoneId).header("Authorization", "Bearer " + otherUser))
            .andExpect(status().isNotFound());
        mvc.perform(delete("/api/zones/" + zoneId).header("Authorization", "Bearer " + owner))
            .andExpect(status().isOk());
        assertEquals(0, dashboard(owner).get("zones").size());
    }

    @Test void activeZonesCannotBeDeletedAndLongWindowsAreRejected() throws Exception {
        String token = register();
        var start = Instant.now().plusSeconds(300);
        zone(token, start, start.plusSeconds(3600), 200);
        long zoneId = dashboard(token).get("zones").get(0).get("id").asLong();
        mvc.perform(delete("/api/zones/" + zoneId).header("Authorization", "Bearer " + token))
            .andExpect(status().isConflict());
        var future = Instant.now().plusSeconds(90000);
        zone(token, future, future.plusSeconds(86401), 400);
    }

    @Test void unicodePasswordsOverBcryptLimitAreRejected() throws Exception {
        String email = UUID.randomUUID() + "@work.org";
        String password = "\u00e9".repeat(40);
        mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
            .content(json.writeValueAsString(Map.of("fullName", "User", "email", email,
                "password", password, "timezone", "UTC"))))
            .andExpect(status().isBadRequest());
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
            .content(json.writeValueAsString(Map.of("email", email, "password", password))))
            .andExpect(status().isUnauthorized());
    }
    @Test void weightsAndUserIsolation() throws Exception  {
        String firstUser=register(),secondUser=register();
        assertEquals(100,dashboard(firstUser).get("capacity").asInt());
        event(firstUser,"NOTIFICATION");
        event(firstUser,"APP_SWITCH");
        event(firstUser,"MESSAGE_REPLY");
        var result=event(firstUser,"FORM_INPUT");
        assertEquals(90,result.get("capacity").asInt());
        assertEquals(4,result.get("events").size());
        assertEquals(100,dashboard(secondUser).get("capacity").asInt());
        assertEquals(0,dashboard(secondUser).get("events").size());
    }
    @Test void zonesRejectOverlapAndInvalidWindow() throws Exception  {
        String token=register();
        Instant start=Instant.now().plusSeconds(3600);
        zone(token,start,start.plusSeconds(1800),200);
        zone(token,start.plusSeconds(600),start.plusSeconds(2000),409);
        zone(token,start,start.minusSeconds(1),400);
    }
    @Test void notificationsHeldButExplicitDecisionsApplied() throws Exception  {
        String token=register();
        Instant start=Instant.now().plusSeconds(300);
        zone(token,start,start.plusSeconds(3600),200);
        var result=event(token,"NOTIFICATION");
        assertEquals(100,result.get("capacity").asInt());
        assertEquals(1,result.get("heldCount").asInt());
        assertEquals("HELD",result.get("events").get(0).get("status").asText());
        assertEquals(97,event(token,"MESSAGE_REPLY").get("capacity").asInt());
    }
    @Test void releasedBatchChargedOnceAndIdempotently() throws Exception  {
        String token=register();
        Instant start=Instant.now().plusSeconds(300);
        zone(token,start,start.plusSeconds(3600),200);
        event(token,"NOTIFICATION");
        var result=event(token,"NOTIFICATION");
        for(var node:result.get("events"))  {
            var event=events.findById(node.get("id").asLong()).orElseThrow();
            event.holdUntil=Instant.now().minusSeconds(1);
            events.saveAndFlush(event);
        }
        var released=dashboard(token);
        assertEquals(99,released.get("capacity").asInt());
        assertEquals(0,released.get("heldCount").asInt());
        assertEquals(1,released.get("summary").get("NOTIFICATION").asInt());
        assertEquals(99,dashboard(token).get("capacity").asInt());
    }
    @Test void nextDayStartsFresh() throws Exception  {
        String token=register();
        event(token,"FORM_INPUT");
        String tomorrow=LocalDate.now(ZoneId.of("Asia/Kolkata")).plusDays(1).toString();
        var result=json.readTree(mvc.perform(get("/api/dashboard").param("date",tomorrow).header("Authorization","Bearer "+token)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertEquals(100,result.get("capacity").asInt());
        assertEquals(0,result.get("events").size());
    }
    @Test void batteryDoesNotGoBelowZero() throws Exception  {
        String token=register();
        JsonNode result=null;
        for(int i=0;i<26;i++) result=event(token,"FORM_INPUT");
        assertEquals(0,result.get("capacity").asInt());
    }
    @Test void loginAndDuplicateAccounts() throws Exception  {
        String email=UUID.randomUUID()+"@work.org";
        var body=Map.of("fullName","User","email",email,"password","secure-test-password","timezone","UTC");
        String payload=json.writeValueAsString(body);
        mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON).content(payload)).andExpect(status().isOk());
        mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON).content(payload)).andExpect(status().isConflict());
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(Map.of("email",email,"password","secure-test-password")))).andExpect(status().isOk());
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(Map.of("email",email,"password","wrong-password")))).andExpect(status().isUnauthorized());
    }
}
