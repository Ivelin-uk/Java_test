package com.quicktest.workspace;

import com.stripe.net.Webhook;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
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
    private final String key,webhookSecret,mode;private final WorkspaceJson json;private final RestClient http;
    public StripeTestGateway(WorkspaceJson json,String key,String webhookSecret) {this(json,key,webhookSecret,"test");}
    @Autowired
    public StripeTestGateway(WorkspaceJson json,@Value("${app.stripe.secret-key:}") String key,@Value("${app.stripe.webhook-secret:}") String webhookSecret,@Value("${app.stripe.mode:test}") String mode) {
        this(json,key,webhookSecret,mode,httpBuilder());
    }
    public StripeTestGateway(WorkspaceJson json,String key,String webhookSecret,String mode,RestClient.Builder builder) {
        if(!java.util.Set.of("test","live").contains(mode) || (!key.isBlank() && !key.startsWith("sk_"+mode+"_"))) throw new IllegalStateException("Stripe mode and key must match");
        this.json=json;this.key=key;this.webhookSecret=webhookSecret;this.mode=mode;
        this.http=builder.baseUrl("https://api.stripe.com").defaultHeader("Authorization","Bearer "+key).defaultHeader("Stripe-Version",com.stripe.Stripe.API_VERSION).build();
    }
    private static RestClient.Builder httpBuilder() {
        var factory=new JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build());factory.setReadTimeout(Duration.ofSeconds(20));
        return RestClient.builder().requestFactory(factory);
    }
    public boolean configured() {return !key.isBlank() && !webhookSecret.isBlank();}
    public String mode() {return mode;}
    private void requireConfigured() {if(!configured()) throw new WorkspaceError(HttpStatus.SERVICE_UNAVAILABLE,"configuration_required","Stripe интеграцията изисква ключ и webhook secret.");}
    public Map<String,Object> teacherCheckout(long user,long workspace,String price,String requestKey,String customer,String returnUrl) {
        requireConfigured();validateId(price,"price_");
        var form=new LinkedMultiValueMap<String,String>();form.add("mode","subscription");form.add("line_items[0][price]",price);form.add("line_items[0][quantity]","1");
        form.add("payment_method_collection","always");
        for(String prefix:java.util.List.of("metadata","subscription_data[metadata]")) {
            form.add(prefix+"[billing_owner]","teacher");form.add(prefix+"[teacher_id]",Long.toString(user));form.add(prefix+"[workspace_id]",Long.toString(workspace));form.add(prefix+"[request_key]",requestKey);
        }
        form.add("client_reference_id",Long.toString(user));
        if(!customer.isBlank()) {validateId(customer,"cus_");form.add("customer",customer);}
        form.add("success_url",returnUrl+"/billing?checkout=success");form.add("cancel_url",returnUrl+"/billing?checkout=canceled");
        return request("/v1/checkout/sessions",form,"teacher-"+user+"-"+requestKey);
    }
    public Map<String,Object> currentCheckout(String id) {return retrieve("/v1/checkout/sessions/",id,"cs_");}
    public Map<String,Object> currentInvoice(String id) {return retrieve("/v1/invoices/",id,"in_");}
    public Map<String,Object> currentPrice(String id) {return retrieve("/v1/prices/",id,"price_");}
    private void validateId(String id,String prefix) {if(id==null || !id.matches(prefix+"[A-Za-z0-9_]+")) throw WorkspaceError.validation("Невалиден Stripe идентификатор.");}
    private Map<String,Object> retrieve(String path,String id,String prefix) {
        requireConfigured();validateId(id,prefix);
        try {return json.object(http.get().uri(path+id).retrieve().body(String.class));}
        catch(org.springframework.web.client.RestClientException error) {throw unavailable();}
    }
    private Map<String,Object> request(String path,LinkedMultiValueMap<String,String> form,String idempotency) {
        requireConfigured();
        try {var request=http.post().uri(path);if(idempotency!=null) request.header("Idempotency-Key",idempotency);return json.object(request.contentType(MediaType.APPLICATION_FORM_URLENCODED).body(form).retrieve().body(String.class));}
        catch(org.springframework.web.client.RestClientException error) {throw unavailable();}
    }
    private WorkspaceError unavailable() {return new PaymentGateway.Unavailable();}
    public Map<String,Object> checkout(long org,String price,String requestKey,String returnUrl) {
        requireConfigured();var form=new LinkedMultiValueMap<String,String>();form.add("mode","subscription");form.add("line_items[0][price]",price);form.add("line_items[0][quantity]","1");form.add("subscription_data[metadata][organization_id]",Long.toString(org));form.add("subscription_data[metadata][request_key]",requestKey);form.add("success_url",returnUrl+"?billing=success");form.add("cancel_url",returnUrl+"?billing=canceled");
        String response=http.post().uri("/v1/checkout/sessions").header("Idempotency-Key","examai-"+requestKey).contentType(MediaType.APPLICATION_FORM_URLENCODED).body(form).retrieve().body(String.class);return json.object(response);
    }
    public Map<String,Object> currentSubscription(String id) {
        requireConfigured();if(!id.matches("sub_[A-Za-z0-9]+")) throw WorkspaceError.validation("Невалиден абонамент.");
        return retrieve("/v1/subscriptions/",id,"sub_");
    }
    public Map<String,Object> portal(String customer,String returnUrl) {
        requireConfigured();if(!customer.matches("cus_[A-Za-z0-9]+")) throw WorkspaceError.validation("Невалиден клиент.");
        var form=new LinkedMultiValueMap<String,String>();form.add("customer",customer);form.add("return_url",returnUrl);return request("/v1/billing_portal/sessions",form,null);
    }
    public Map<String,Object> cancelAtPeriodEnd(String subscription) {
        requireConfigured();validateId(subscription,"sub_");
        var form=new LinkedMultiValueMap<String,String>();form.add("cancel_at_period_end","true");
        return request("/v1/subscriptions/"+subscription,form,null);
    }
    public Map<String,Object> verifyWebhook(String payload,String signature) {
        requireConfigured();
        try {var event=Webhook.constructEvent(payload,signature,webhookSecret);if(Boolean.TRUE.equals(event.getLivemode())!=mode.equals("live")) throw WorkspaceError.forbidden();return json.object(payload);}
        catch(com.stripe.exception.SignatureVerificationException|RuntimeException error) {throw WorkspaceError.validation("Невалиден Stripe подпис или събитие.");}
    }
}
