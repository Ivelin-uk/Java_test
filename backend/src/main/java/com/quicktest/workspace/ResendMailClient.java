package com.quicktest.workspace;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;

@Component
public class ResendMailClient {
    private final WorkspaceJson json;
    private final HttpClient client;
    private final String key;
    @Autowired
    public ResendMailClient(WorkspaceJson json,@Value("${app.mail.resend.api-key:}") String key) {
        this(json,HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NEVER).build(),key);
    }
    public ResendMailClient(WorkspaceJson json,HttpClient client,String key) {this.json=json;this.client=client;this.key=key;}
    public boolean configured() {return key!=null && !key.isBlank();}
    public String send(long notification,String from,String recipient,MailContent content) {
        var request=HttpRequest.newBuilder(URI.create("https://api.resend.com/emails"))
                .timeout(Duration.ofSeconds(25)).header("Authorization","Bearer "+key).header("Content-Type","application/json")
                .header("Idempotency-Key","examai-"+notification+"-"+UUID.nameUUIDFromBytes((from+"\n"+recipient+"\n"+content.text()).getBytes(StandardCharsets.UTF_8)))
                .POST(HttpRequest.BodyPublishers.ofString(json.write(Map.of("from",from,"to",List.of(recipient),"subject",content.subject(),"text",content.text(),"html",content.html())),StandardCharsets.UTF_8)).build();
        try {
            var response=client.send(request,HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            int status=response.statusCode();
            if(Set.of(400,401,403,404,422,429).contains(status)) throw new MailDeliveryRejected();
            if(status<200 || status>=300) throw new org.springframework.mail.MailSendException("Email delivery outcome is unknown");
            String receipt=Objects.toString(json.object(response.body()).get("id"),"");
            if(receipt.isBlank() || receipt.length()>190) throw new org.springframework.mail.MailSendException("Email delivery was not confirmed");
            return receipt;
        } catch(InterruptedException interrupted) {
            Thread.currentThread().interrupt();throw new org.springframework.mail.MailSendException("Email delivery interrupted");
        } catch(java.io.IOException failure) {throw new org.springframework.mail.MailSendException("Email delivery could not be confirmed");}
    }
}
