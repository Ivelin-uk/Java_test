package com.quicktest.workspace;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.*;
import org.springframework.stereotype.Component;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static com.quicktest.workspace.WorkspaceValues.*;

@Component
public class ConfiguredMailGateway implements MailGateway {
    private final ResendMailClient resend;private final JavaMailSender sender;private final String adapter,from,frontend;private final Set<String> allowed;
    public ConfiguredMailGateway(ObjectProvider<JavaMailSender> sender,ResendMailClient resend,@Value("${app.mail.adapter:local}") String adapter,@Value("${app.mail.from:examai@localhost}") String from,@Value("${app.frontend-url}") String frontend,@Value("${app.mail.allowed-domains:example.test,quicktest.local,examai.local}") String domains) {
        this.resend=resend;this.sender=sender.getIfAvailable();this.adapter=adapter;this.from=from;this.frontend=frontend;this.allowed=new HashSet<>();for(String domain:domains.toLowerCase(Locale.ROOT).split(",")) if(!domain.isBlank()) this.allowed.add(domain.strip());
        if(!Set.of("local","smtp","resend").contains(adapter) || adapter.equals("smtp") && this.sender==null) throw new IllegalStateException("Configure a supported MAIL_ADAPTER and its credentials");
        if(adapter.equals("resend") && (!resend.configured() || !from.matches("[^\\s<>@]+@[^\\s<>@]+\\.[^\\s<>@]+") || !frontend.startsWith("https://"))) throw new IllegalStateException("Resend requires RESEND_API_KEY, MAIL_FROM on a verified domain and HTTPS FRONTEND_URL");
    }
    public String send(long notification,String recipient,Map<String,Object> payload) {
        if(adapter.equals("local")) return "local-"+notification;
        String domain=recipient.substring(recipient.lastIndexOf('@')+1).toLowerCase(Locale.ROOT);
        if(!allowed.contains(domain) && !allowed.contains("*")) throw new org.springframework.mail.MailAuthenticationException("Recipient domain is not on the configured test allowlist");
        MailContent content=MailContent.render(payload,frontend);
        if(adapter.equals("resend")) return resend.send(notification,from,recipient,content);
        try {
            var message=sender.createMimeMessage();var helper=new MimeMessageHelper(message,StandardCharsets.UTF_8.name());helper.setFrom(from);helper.setTo(recipient);
            helper.setSubject(content.subject());
            helper.setText(content.text(),content.html());message.setHeader("X-ExamAI-Notification",Long.toString(notification));sender.send(message);return Objects.toString(message.getMessageID(),"smtp-"+notification);
        } catch(jakarta.mail.MessagingException exception) {throw new org.springframework.mail.MailSendException("SMTP delivery could not be confirmed",exception);}
    }
}
