package com.quicktest.workspace;

import com.stripe.net.Webhook;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.RestClient;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.Map;

@Component
public class StripeTestGateway implements PaymentGateway {
    private final String key,webhookSecret;private final WorkspaceStore db;private final RestClient http;
    public StripeTestGateway(WorkspaceStore db,@Value("${app.stripe.secret-key:}") String key,@Value("${app.stripe.webhook-secret:}") String webhookSecret) {
        if(!key.isBlank() && !key.startsWith("sk_test_")) throw new IllegalStateException("Only Stripe test keys are allowed in this implementation");
        this.db=db;this.key=key;this.webhookSecret=webhookSecret;
        var factory=new JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build());factory.setReadTimeout(Duration.ofSeconds(20));
        this.http=RestClient.builder().baseUrl("https://api.stripe.com").requestFactory(factory).defaultHeader("Authorization","Bearer "+key).defaultHeader("Stripe-Version",com.stripe.Stripe.API_VERSION).build();
    }
    public boolean configured() {return !key.isBlank() && !webhookSecret.isBlank();}
    private void requireConfigured() {if(!configured()) throw new WorkspaceError(HttpStatus.SERVICE_UNAVAILABLE,"configuration_required","Stripe test интеграцията изисква ключ и webhook secret.");}
    public Map<String,Object> checkout(long org,String price,String requestKey,String returnUrl) {
        requireConfigured();var form=new LinkedMultiValueMap<String,String>();form.add("mode","subscription");form.add("line_items[0][price]",price);form.add("line_items[0][quantity]","1");form.add("subscription_data[metadata][organization_id]",Long.toString(org));form.add("subscription_data[metadata][request_key]",requestKey);form.add("success_url",returnUrl+"?billing=success");form.add("cancel_url",returnUrl+"?billing=canceled");
        String response=http.post().uri("/v1/checkout/sessions").header("Idempotency-Key","examai-"+requestKey).contentType(MediaType.APPLICATION_FORM_URLENCODED).body(form).retrieve().body(String.class);return db.object(response);
    }
    public Map<String,Object> currentSubscription(String id) {
        requireConfigured();if(!id.matches("sub_[A-Za-z0-9]+")) throw WorkspaceError.validation("Невалиден абонамент.");
        return db.object(http.get().uri("/v1/subscriptions/"+id).retrieve().body(String.class));
    }
    public Map<String,Object> portal(String customer,String returnUrl) {
        requireConfigured();if(!customer.matches("cus_[A-Za-z0-9]+")) throw WorkspaceError.validation("Невалиден клиент.");
        var form=new LinkedMultiValueMap<String,String>();form.add("customer",customer);form.add("return_url",returnUrl);return db.object(http.post().uri("/v1/billing_portal/sessions").contentType(MediaType.APPLICATION_FORM_URLENCODED).body(form).retrieve().body(String.class));
    }
    public Map<String,Object> verifyWebhook(String payload,String signature) {
        requireConfigured();
        try {var event=Webhook.constructEvent(payload,signature,webhookSecret);if(Boolean.TRUE.equals(event.getLivemode())) throw WorkspaceError.forbidden();return db.object(payload);}
        catch(com.stripe.exception.SignatureVerificationException|RuntimeException error) {throw WorkspaceError.validation("Невалиден Stripe подпис или събитие.");}
    }
}
