FROM eclipse-temurin:21-jdk AS build
WORKDIR /app
COPY gradlew gradlew.bat build.gradle.kts settings.gradle.kts ./
COPY gradle ./gradle
COPY src ./src
RUN chmod +x gradlew && ./gradlew --no-daemon bootJar
FROM eclipse-temurin:21-jre
WORKDIR /app
RUN groupadd --gid 10001 examai && useradd --uid 10001 --gid examai examai
COPY --from=build /app/build/libs/backend-0.0.1-SNAPSHOT.jar app.jar
USER examai
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
