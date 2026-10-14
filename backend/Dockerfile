FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /build
COPY backend/pom.xml pom.xml
COPY backend/src src
RUN mvn -B -DskipTests package

FROM eclipse-temurin:17-jre-alpine
RUN addgroup -S aegis && adduser -S aegis -G aegis
WORKDIR /app
COPY --from=build /build/target/backend-0.1.0.jar app.jar
USER aegis
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
