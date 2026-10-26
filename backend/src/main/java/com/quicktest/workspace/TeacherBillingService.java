package com.quicktest.workspace;

import com.quicktest.auth.AppUser;
import com.quicktest.auth.Role;
import com.quicktest.workspace.repository.TeacherBillingRepository;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.net.URI;
import java.time.*;
import java.util.*;
import static com.quicktest.workspace.WorkspaceValues.*;

/** Personal teacher billing. Provider subscription status alone never grants paid time. */
@Service
public class TeacherBillingService {
    private final TeacherBillingRepository repository;
    private final PaymentGateway gateway;
    private final PersonalWorkspace personal;
    private final WorkspaceAudit audit;
    private final WorkspaceJson json;
    private final Clock clock;
    private final String frontend,monthPrice,yearPrice;
    public TeacherBillingService(TeacherBillingRepository repository,PaymentGateway gateway,PersonalWorkspace personal,WorkspaceAudit audit,WorkspaceJson json,Clock clock,
            @Value("${app.frontend-url}") String frontend,@Value("${app.stripe.pro-month-price-id:}") String monthPrice,@Value("${app.stripe.pro-year-price-id:}") String yearPrice) {
        this.repository=repository;this.gateway=gateway;this.personal=personal;this.audit=audit;this.json=json;this.clock=clock;
        this.frontend=frontend.replaceAll("/+$","");this.monthPrice=monthPrice;this.yearPrice=yearPrice;
    }
    public Optional<Map<String,Object>> subscription(long user) {return repository.findByUserId(user);}
    public boolean isPro(long user) {return repository.findByUserId(user).map(this::paid).orElse(false);}
    private boolean paid(Map<String,Object> account) {
        return string(account,"stripe_mode").equals(gateway.mode()) && account.get("paid_through")!=null && time(account,"paid_through").isAfter(clock.instant());
    }
    public Map<String,Object> describe(AppUser user) {
        teacher(user);var account=repository.findByUserId(user.getId()).orElse(Map.of());
        Map<String,Object> result=new LinkedHashMap<>();result.put("plan",paid(account)?"pro":"free");
        result.put("status",string(account,"provider_status").isBlank()?"free":string(account,"provider_status"));
        result.put("paidThrough",account.get("paid_through"));result.put("cancelAtPeriodEnd",flag(account,"cancel_at_period_end"));
        result.put("mode",gateway.configured()?gateway.mode():"unconfigured");
        var month=priceDescription("month");var year=priceDescription("year");
        result.put("prices",Map.of("month",month,"year",year));
        result.put("checkoutAvailable",!paid(account) && (Boolean.TRUE.equals(month.get("available")) || Boolean.TRUE.equals(year.get("available"))) && replaceable(account));
        result.put("portalAvailable",gateway.configured() && string(account,"stripe_mode").equals(gateway.mode()) && !string(account,"stripe_customer_id").isBlank());
        return result;
    }
    private Map<String,Object> priceDescription(String period) {
        String priceId=priceId(period);if(!gateway.configured() || priceId.isBlank()) return Map.of("available",false);
        var price=verifiedPrice(period);var result=new LinkedHashMap<String,Object>();result.put("available",true);
        if(price.get("unit_amount") instanceof Number amount) result.put("amountMinor",amount.longValue());
        result.put("currency",string(price,"currency"));return result;
    }
    @Transactional(noRollbackFor=PaymentGateway.Unavailable.class)
    public Map<String,Object> checkout(AppUser user,Checkout request) {
        teacher(user);
        if(request==null || request.requestKey()==null || !request.requestKey().matches("[A-Za-z0-9_-]{8,80}") || !Set.of("month","year").contains(Objects.toString(request.period(),""))) throw WorkspaceError.validation("Избери месечен или годишен абонамент.");
        long workspace=personal.workspace(user);repository.lockTeacher(user.getId());
        var account=account(user.getId(),workspace);sameMode(account);
        if(paid(account) || !replaceable(account)) throw WorkspaceError.conflict("Вече имаш абонамент. Управлявай го през платежния портал.");
        String price=priceId(request.period());verifiedPrice(request.period());
        var previous=repository.findCheckout(user.getId(),request.requestKey());
        if(previous.isPresent()) {
            var row=previous.get();if(!string(row,"billing_period").equals(request.period()) || !string(row,"price_id").equals(price)) throw WorkspaceError.conflict("Ключът вече е използван за друго плащане.");
            if(!string(row,"status").equals("pending")) throw WorkspaceError.conflict("Това плащане вече е приключило. Започни отново от страницата за абонамент.");
            if(string(row,"session_id").isBlank() && time(row,"created_at").isBefore(clock.instant().minus(Duration.ofHours(23)))) throw WorkspaceError.conflict("Плащането изисква проверка от поддръжката, преди да се започне ново.");
            if(!string(row,"session_id").isBlank()) {
                var current=gateway.currentCheckout(string(row,"session_id"));verifyMode(current);
                if(string(current,"status").equals("open")) return Map.of("url",safeUrl(string(current,"url"),"checkout.stripe.com"));
                throw WorkspaceError.conflict("Плащането е приключило или е изтекло. Изчакай обновяването на абонамента или започни отново.");
            }
        } else {
            var pending=repository.pendingCheckout(user.getId());
            if(pending.isPresent()) {
                var row=pending.get();if(string(row,"session_id").isBlank()) throw WorkspaceError.conflict("Вече се подготвя плащане. Опитай отново със същата заявка.");
                var current=gateway.currentCheckout(string(row,"session_id"));verifyMode(current);
                if(!string(current,"status").equals("expired")) throw WorkspaceError.conflict("Вече има започнато плащане. Завърши го или изчакай да изтече.");
                repository.finishCheckout(user.getId(),string(row,"request_key"),"expired");
            }
            repository.createCheckout(user.getId(),request.requestKey(),request.period(),price,clock.instant());
        }
        var session=gateway.teacherCheckout(user.getId(),workspace,price,request.requestKey(),string(account,"stripe_customer_id"),frontend);verifyMode(session);
        String id=identifier(string(session,"id"),"cs_");String url=safeUrl(string(session,"url"),"checkout.stripe.com");
        repository.saveCheckout(user.getId(),request.requestKey(),id,url);
        audit.write(workspace,user.getId(),"teacher_billing.checkout_created",null,Map.of("period",request.period(),"mode",gateway.mode()));
        return Map.of("url",url);
    }
    @Transactional
    public Map<String,Object> portal(AppUser user) {
        teacher(user);personal.workspace(user);repository.lockTeacher(user.getId());
        var account=repository.findByUserId(user.getId()).orElseThrow(()->WorkspaceError.conflict("Все още няма платежен профил."));sameMode(account);
        String customer=identifier(string(account,"stripe_customer_id"),"cus_");
        var session=gateway.portal(customer,frontend+"/billing");
        if(session.containsKey("livemode")) verifyMode(session);
        audit.write(number(account,"workspace_id"),user.getId(),"teacher_billing.portal_opened",null,Map.of());
        return Map.of("url",safeUrl(string(session,"url"),"billing.stripe.com"));
    }
    /** false means an authenticated legacy organization event, for the existing adapter. */
    @Transactional
    public boolean webhook(String body,String signature) {
        if(body==null || body.length()>1_000_000) throw WorkspaceError.validation("Невалидно платежно събитие.");
        var event=gateway.verifyWebhook(body,signature);verifyMode(event);
        String type=string(event,"type");var object=obj(obj(event.get("data")).get("object"));
        if(!Set.of("customer.subscription.created","customer.subscription.updated","customer.subscription.deleted","invoice.paid","invoice.payment_failed","checkout.session.completed","checkout.session.expired").contains(type)) return true;
        var metadata=obj(object.get("metadata"));
        if(type.startsWith("customer.subscription.") && !string(metadata,"organization_id").isBlank() && string(metadata,"billing_owner").isBlank()) return false;
        String subscriptionId=type.startsWith("customer.subscription.")?string(object,"id"):subscriptionId(object);
        if(type.startsWith("checkout.session.") && subscriptionId.isBlank()) {
            if(!string(metadata,"billing_owner").equals("teacher")) return true;
            long user=owner(metadata);repository.lockTeacher(user);var account=repository.findByUserId(user).orElseThrow(WorkspaceError::forbidden);sameMode(account);
            var request=verifiedRequest(user,account,metadata);if(!string(request,"session_id").equals(string(object,"id"))) throw WorkspaceError.forbidden();
            String eventId=identifier(string(event,"id"),"evt_");if(repository.seenEvent(eventId)) return true;
            if(type.equals("checkout.session.expired")) repository.finishCheckout(user,string(metadata,"request_key"),"expired");
            repository.recordEvent(eventId,user,type,epoch(event,"created"),clock.instant());return true;
        }
        if(subscriptionId.isBlank()) return true;
        identifier(subscriptionId,"sub_");
        var preview=gateway.currentSubscription(subscriptionId);var previewMetadata=obj(preview.get("metadata"));
        if(!string(previewMetadata,"billing_owner").equals("teacher")) return true;
        long user=owner(previewMetadata);repository.lockTeacher(user);
        String eventId=identifier(string(event,"id"),"evt_");if(repository.seenEvent(eventId)) return true;
        var account=repository.findByUserId(user).orElseThrow(WorkspaceError::forbidden);sameMode(account);
        // Re-fetch after the lock. Reordered events cannot restore an obsolete provider status.
        var current=gateway.currentSubscription(subscriptionId);verifyMode(current);
        if(!string(current,"id").equals(subscriptionId) || !string(current,"collection_method").equals("charge_automatically")) throw WorkspaceError.forbidden();
        var currentMetadata=obj(current.get("metadata"));var request=verifiedRequest(user,account,currentMetadata);
        if(type.startsWith("customer.subscription.") || type.startsWith("checkout.session.")) verifiedRequest(user,account,metadata);
        var item=subscriptionItem(current);String price=priceIdentifier(item);
        if(!price.equals(string(request,"price_id")) || !price.equals(priceId(string(request,"billing_period"))) || epoch(item,"quantity")!=1) throw WorkspaceError.forbidden();
        String customer=identifier(reference(current.get("customer")),"cus_");
        if(!string(account,"stripe_customer_id").isBlank() && !string(account,"stripe_customer_id").equals(customer)) throw WorkspaceError.forbidden();
        String bound=string(account,"stripe_subscription_id");
        if(!bound.isBlank() && !bound.equals(subscriptionId)) {
            if(string(request,"status").equals("complete")) {repository.recordEvent(eventId,user,type,epoch(event,"created"),clock.instant());return true;}
            if(!replaceable(account)) throw WorkspaceError.conflict("Вече има друг активен абонамент.");
        }
        if(!bound.equals(subscriptionId)) {
            var session=gateway.currentCheckout(string(request,"session_id"));verifyMode(session);
            if(!reference(session.get("subscription")).equals(subscriptionId) || !reference(session.get("customer")).equals(customer)) throw WorkspaceError.forbidden();
            verifiedRequest(user,account,obj(session.get("metadata")));
        }
        Instant through=account.get("paid_through")==null?null:time(account,"paid_through");
        String latest=reference(current.get("latest_invoice"));
        if(!latest.isBlank()) through=paidInvoiceThrough(gateway.currentInvoice(identifier(latest,"in_")),subscriptionId,customer,price,through);
        // An older paid renewal may arrive after the current invoice failed; only its paid line can extend access.
        if(type.equals("invoice.paid") && !string(object,"id").equals(latest)) through=paidInvoiceThrough(gateway.currentInvoice(identifier(string(object,"id"),"in_")),subscriptionId,customer,price,through);
        repository.update(user,customer,subscriptionId,string(current,"status"),through,flag(current,"cancel_at_period_end"),clock.instant());
        repository.finishCheckout(user,string(request,"request_key"),"complete");
        repository.recordEvent(eventId,user,type,epoch(event,"created"),clock.instant());
        audit.write(number(account,"workspace_id"),user,"teacher_billing.subscription_updated",null,Map.of("status",string(current,"status"),"event",eventId));
        return true;
    }
    private Instant paidInvoiceThrough(Map<String,Object> invoice,String subscription,String customer,String price,Instant through) {
        verifyMode(invoice);
        if(!subscriptionId(invoice).equals(subscription) || !reference(invoice.get("customer")).equals(customer)) throw WorkspaceError.forbidden();
        if(!string(invoice,"status").equals("paid")) return through;
        var lines=obj(invoice.get("lines")).get("data");if(!(lines instanceof List<?> list)) throw WorkspaceError.validation("Липсват данни за платения период.");
        Instant verified=null;
        for(Object raw:list) {
            var line=obj(raw);if(!priceIdentifier(line).equals(price)) continue;
            // Prorations are adjustments, not proof that a complete recurring period was paid.
            var details=obj(obj(line.get("parent")).get("subscription_item_details"));
            if(flag(line,"proration") || flag(details,"proration")) continue;
            var period=obj(line.get("period"));long end=epoch(period,"end"),start=epoch(period,"start");
            if(end<=start || start<=0) continue;
            var candidate=Instant.ofEpochSecond(end);if(verified==null || candidate.isAfter(verified)) verified=candidate;
        }
        return verified!=null && (through==null || verified.isAfter(through))?verified:through;
    }
    private Map<String,Object> verifiedRequest(long user,Map<String,Object> account,Map<String,Object> metadata) {
        if(!string(metadata,"billing_owner").equals("teacher") || owner(metadata)!=user || !string(metadata,"workspace_id").equals(Long.toString(number(account,"workspace_id")))) throw WorkspaceError.forbidden();
        return repository.findCheckout(user,string(metadata,"request_key")).orElseThrow(WorkspaceError::forbidden);
    }
    private Map<String,Object> account(long user,long workspace) {
        var existing=repository.findByUserId(user);if(existing.isPresent()) return existing.get();
        repository.create(user,workspace,gateway.mode(),clock.instant());return repository.findByUserId(user).orElseThrow();
    }
    private boolean replaceable(Map<String,Object> account) {return string(account,"stripe_subscription_id").isBlank() || Set.of("canceled","incomplete_expired").contains(string(account,"provider_status"));}
    private void teacher(AppUser user) {if(user==null || user.getRole()!=Role.TEACHER || !user.isActive()) throw WorkspaceError.forbidden();}
    private void sameMode(Map<String,Object> account) {if(!string(account,"stripe_mode").equals(gateway.mode())) throw WorkspaceError.conflict("Платежният профил е в друг Stripe режим. Свържи се с поддръжката.");}
    private void verifyMode(Map<String,Object> object) {if(!(object.get("livemode") instanceof Boolean) || flag(object,"livemode")!=gateway.mode().equals("live")) throw WorkspaceError.forbidden();}
    private String priceId(String period) {return period.equals("month")?monthPrice:yearPrice;}
    private Map<String,Object> verifiedPrice(String period) {
        String id=priceId(period);if(!gateway.configured() || id.isBlank()) throw WorkspaceError.conflict("Плащанията още не са настроени. Свържи се с поддръжката.");
        var price=gateway.currentPrice(identifier(id,"price_"));verifyMode(price);var recurring=obj(price.get("recurring"));
        if(!string(price,"id").equals(id) || !flag(price,"active") || !string(price,"type").equals("recurring") || !string(recurring,"interval").equals(period) || epoch(recurring,"interval_count")!=1 || !string(price,"billing_scheme").equals("per_unit") || price.get("unit_amount")==null) throw WorkspaceError.conflict("Цената за този абонамент не е конфигурирана правилно.");
        return price;
    }
    private Map<String,Object> subscriptionItem(Map<String,Object> subscription) {Object items=obj(subscription.get("items")).get("data");if(!(items instanceof List<?> list) || list.size()!=1) throw WorkspaceError.forbidden();return obj(list.getFirst());}
    private String priceIdentifier(Map<String,Object> object) {String old=reference(object.get("price"));return old.isBlank()?reference(obj(obj(object.get("pricing")).get("price_details")).get("price")):old;}
    private String subscriptionId(Map<String,Object> object) {String old=reference(object.get("subscription"));return old.isBlank()?reference(obj(obj(object.get("parent")).get("subscription_details")).get("subscription")):old;}
    private long owner(Map<String,Object> metadata) {try {long user=Long.parseLong(string(metadata,"teacher_id"));if(user>0) return user;} catch(NumberFormatException ignored) {}throw WorkspaceError.forbidden();}
    private long epoch(Map<String,Object> object,String key) {return object.get(key) instanceof Number value?value.longValue():0;}
    private String reference(Object value) {return value instanceof String text?text:string(obj(value),"id");}
    @SuppressWarnings("unchecked") private Map<String,Object> obj(Object value) {return value instanceof Map<?,?> map?(Map<String,Object>)map:Map.of();}
    private String identifier(String id,String prefix) {if(!id.matches(prefix+"[A-Za-z0-9_]+")) throw WorkspaceError.validation("Невалиден Stripe идентификатор.");return id;}
    private String safeUrl(String url,String host) {try {var uri=URI.create(url);if(uri.getScheme().equals("https") && host.equals(uri.getHost()) && uri.getUserInfo()==null && uri.getPort()==-1) return url;} catch(RuntimeException ignored) {}throw WorkspaceError.validation("Невалиден адрес на платежната услуга.");}
    public record Checkout(@NotBlank @Pattern(regexp="month|year") String period,@NotBlank @Pattern(regexp="[A-Za-z0-9_-]{8,80}") String requestKey) {}
}
