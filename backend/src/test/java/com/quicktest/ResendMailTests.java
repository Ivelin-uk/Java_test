package com.quicktest;

import com.quicktest.workspace.*;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.support.DefaultListableBeanFactory;
import org.springframework.mail.javamail.JavaMailSender;
import java.net.http.*;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.Flow;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ResendMailTests {
    private final WorkspaceJson json=new WorkspaceJson(new tools.jackson.databind.ObjectMapper());
    private Map<String,Object> payload() {
        return Map.of("notificationType","final_result","test","Алгебра <script>alert(1)</script>","student","Ученик","attemptNumber",2,"points",8,"maximumPoints",10,"percentage",80,"grade","5","outcome","passed","protectedPath","/results/123");
    }
    @SuppressWarnings("unchecked")
    private HttpClient client(int status,String body) throws Exception {
        HttpClient client=mock(HttpClient.class);HttpResponse<String> response=mock(HttpResponse.class);
        when(response.statusCode()).thenReturn(status);when(response.body()).thenReturn(body);
        when(client.send(any(HttpRequest.class),org.mockito.ArgumentMatchers.<HttpResponse.BodyHandler<String>>any())).thenReturn(response);
        return client;
    }
    private String body(HttpRequest request) throws Exception {
        var out=new java.io.ByteArrayOutputStream();var complete=new CompletableFuture<String>();
        request.bodyPublisher().orElseThrow().subscribe(new Flow.Subscriber<ByteBuffer>() {
            public void onSubscribe(Flow.Subscription subscription) {subscription.request(Long.MAX_VALUE);}
            public void onNext(ByteBuffer bytes) {byte[] chunk=new byte[bytes.remaining()];bytes.get(chunk);out.writeBytes(chunk);}
            public void onError(Throwable error) {complete.completeExceptionally(error);}
            public void onComplete() {complete.complete(out.toString(StandardCharsets.UTF_8));}
        });
        return complete.get(5,TimeUnit.SECONDS);
    }
    @Test void sendsHttpsRequestWithProtectedResultLinkEscapedHtmlAndIdempotency() throws Exception {
        var http=client(200,"{\"id\":\"provider-receipt\"}");var adapter=new ResendMailClient(json,http,"re_test_fixture_only");
        var content=MailContent.render(payload(),"https://examai.up.railway.app/");
        assertEquals("provider-receipt",adapter.send(55,"results@example.test","student@example.test",content));
        adapter.send(55,"results@example.test","student@example.test",content);
        var requests=ArgumentCaptor.forClass(HttpRequest.class);verify(http,times(2)).send(requests.capture(),org.mockito.ArgumentMatchers.<HttpResponse.BodyHandler<String>>any());
        var request=requests.getValue();assertEquals("https://api.resend.com/emails",request.uri().toString());assertEquals("POST",request.method());
        assertEquals("Bearer re_test_fixture_only",request.headers().firstValue("Authorization").orElseThrow());
        assertEquals(requests.getAllValues().getFirst().headers().firstValue("Idempotency-Key"),request.headers().firstValue("Idempotency-Key"));
        var sent=json.object(body(request));assertEquals(List.of("student@example.test"),sent.get("to"));
        assertTrue(sent.get("text").toString().contains("https://examai.up.railway.app/results/123"));
        assertTrue(sent.get("html").toString().contains("href=\"https://examai.up.railway.app/results/123\""));
        assertFalse(sent.get("html").toString().contains("<script>"));assertTrue(sent.get("html").toString().contains("&lt;script&gt;"));
    }
    @Test void providerRejectionsAreDistinguishedFromAmbiguousFailures() throws Exception {
        for(int status:List.of(400,401,403,422,429)) assertThrows(MailDeliveryRejected.class,()->new ResendMailClient(json,client(status,"secret provider error"),"fixture").send(1,"sender@example.test","student@example.test",MailContent.render(payload(),"https://example.test")));
        for(int status:List.of(409,500,503)) assertThrows(org.springframework.mail.MailSendException.class,()->new ResendMailClient(json,client(status,"secret provider error"),"fixture").send(1,"sender@example.test","student@example.test",MailContent.render(payload(),"https://example.test")));
        assertThrows(org.springframework.mail.MailSendException.class,()->new ResendMailClient(json,client(200,"{}"),"fixture").send(1,"sender@example.test","student@example.test",MailContent.render(payload(),"https://example.test")));
    }
    @Test void resendConfigurationFailsClearlyAndRecipientAllowlistIsEnforced() throws Exception {
        var sender=new DefaultListableBeanFactory().getBeanProvider(JavaMailSender.class);
        var client=new ResendMailClient(json,client(200,"{\"id\":\"mail-1\"}"),"fixture");
        assertThrows(IllegalStateException.class,()->new ConfiguredMailGateway(sender,new ResendMailClient(json,""),"resend","sender@example.test","https://example.test","example.test"));
        assertThrows(IllegalStateException.class,()->new ConfiguredMailGateway(sender,client,"resend","sender@example.test","http://localhost:5173","example.test"));
        var gateway=new ConfiguredMailGateway(sender,client,"resend","sender@example.test","https://example.test"," example.test ");
        assertThrows(org.springframework.mail.MailAuthenticationException.class,()->gateway.send(1,"student@other.test",payload()));
        assertEquals("mail-1",gateway.send(1,"student@example.test",payload()));
        assertEquals("local-2",new ConfiguredMailGateway(sender,client,"local","sender@example.test","http://localhost:5173","example.test").send(2,"demo@quicktest.local",payload()));
    }
}
