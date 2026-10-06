package com.quicktest.workspace;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.*;
import org.springframework.stereotype.Component;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static com.quicktest.workspace.WorkspaceStore.*;

@Component
public class ConfiguredMailGateway implements MailGateway {
    private final JavaMailSender sender;private final String adapter,from,frontend;private final Set<String> allowed;
    public ConfiguredMailGateway(ObjectProvider<JavaMailSender> sender,@Value("${app.mail.adapter:local}") String adapter,@Value("${app.mail.from:examai@localhost}") String from,@Value("${app.frontend-url}") String frontend,@Value("${app.mail.allowed-domains:example.test,quicktest.local,examai.local}") String domains) {
        this.sender=sender.getIfAvailable();this.adapter=adapter;this.from=from;this.frontend=frontend;this.allowed=Set.copyOf(Arrays.asList(domains.toLowerCase(Locale.ROOT).split(",")));
        if(!Set.of("local","smtp").contains(adapter) || adapter.equals("smtp") && this.sender==null) throw new IllegalStateException("MAIL_ADAPTER=smtp requires SMTP configuration");
    }
    public String send(long notification,String recipient,Map<String,Object> payload) {
        if(adapter.equals("local")) return "local-"+notification;
        String domain=recipient.substring(recipient.lastIndexOf('@')+1).toLowerCase(Locale.ROOT);
        if(!allowed.contains(domain)) throw new org.springframework.mail.MailAuthenticationException("Recipient domain is not on the configured test allowlist");
        try {
            var message=sender.createMimeMessage();var helper=new MimeMessageHelper(message,StandardCharsets.UTF_8.name());helper.setFrom(from);helper.setTo(recipient);
            String type=string(payload,"notificationType");String body;
            if(type.equals("final_result")) {
                helper.setSubject(("ExamAI: "+(Boolean.TRUE.equals(payload.get("corrected"))?"Коригиран резултат: ":"")+string(payload,"test")).replaceAll("[\\r\\n]"," "));
                body="Организация: "+string(payload,"organization")+"\nТест: "+string(payload,"test")+"\nОбучаем: "+string(payload,"student")+"\nОпит: "+string(payload,"attemptNumber")+"\nТочки: "+string(payload,"points")+" / "+string(payload,"maximumPoints")+"\nПроцент: "+string(payload,"percentage")+"%\nОценка: "+string(payload,"grade")+"\nИзход: "+string(payload,"outcome")+"\nДата: "+string(payload,"date")+"\nЗащитен резултат: "+frontend+string(payload,"protectedPath");
            } else if(type.equals("invitation")) {helper.setSubject("ExamAI: Покана за "+string(payload,"organization").replaceAll("[\\r\\n]"," "));body="Покана: "+frontend+"/#invitation="+string(payload,"token")+"\nВалидна до: "+string(payload,"expires_at");
            } else if(type.equals("assignment_code")) {helper.setSubject("ExamAI: Код за тест");body="Организация: "+string(payload,"organization")+"\nТест: "+string(payload,"test")+"\nКод: "+string(payload,"code")+"\nВход: "+frontend;
            } else {
                helper.setSubject("ExamAI: "+(type.equals("notification_email")?"Потвърждение на имейл":"Възстановяване на парола"));
                body="Линк: "+frontend+(type.equals("notification_email")?"/verify-email?token=":"/reset-password?token=")+string(payload,"token")+"\nВалиден до: "+string(payload,"expires_at");
            }
            helper.setText(body,false);message.setHeader("X-ExamAI-Notification",Long.toString(notification));sender.send(message);return Objects.toString(message.getMessageID(),"smtp-"+notification);
        } catch(jakarta.mail.MessagingException exception) {throw new org.springframework.mail.MailSendException("SMTP delivery could not be confirmed",exception);}
    }
}
