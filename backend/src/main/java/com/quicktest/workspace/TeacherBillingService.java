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
    public static final long MONTHLY_AMOUNT_MINOR=800;
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
    public boolean isPro(long user) {return repository.planOverride(user).map(plan->plan.equals("pro")).orElseGet(()->repository.findByUserId(user).map(this::paid).orElse(false));}
    private boolean paid(Map<String,Object> account) {
        return string(account,"stripe_mode").equals(gateway.mode()) && account.get("paid_through")!=null && time(account,"paid_through").isAfter(clock.instant());
    }
    public Map<String,Object> describe(AppUser user) {
        teacher(user);var account=repository.findByUserId(user.getId()).orElse(Map.of());
        Map<String,Object> result=new LinkedHashMap<>();result.put("plan",isPro(user.getId())?"pro":"free");
        result.put("manualPlan",repository.planOverride(user.getId()).orElse(null));
        result.put("status",string(account,"provider_status").isBlank()?"free":string(account,"provider_status"));
        result.put("currentPeriod",paid(account)?string(account,"billing_period"):null);
        result.put("paidThrough",account.get("paid_through"));result.put("cancelAtPeriodEnd",flag(account,"cancel_at_period_end"));
        result.put("mode",gateway.configured()?gateway.mode():"unconfigured");
        var month=priceDescription("month");var year=priceDescription("year");
        result.put("prices",Map.of("month",month,"year",year));
        result.put("checkoutAvailable",!isPro(user.getId()) && !paid(account) && (Boolean.TRUE.equals(month.get("available")) || Boolean.TRUE.equals(year.get("available"))) && replaceable(account));
        result.put("portalAvailable",gateway.configured() && string(account,"stripe_mode").equals(gateway.mode()) && !string(account,"stripe_customer_id").isBlank());
        result.put("cancellationAvailable",gateway.configured() && string(account,"stripe_mode").equals(gateway.mode()) && !string(account,"stripe_subscription_id").isBlank() && !flag(account,"cancel_at_period_end") && !Set.of("canceled","incomplete_expired").contains(string(account,"provider_status")));
        return result;
    }
    @Transactional(readOnly=true)
    public List<PaymentRecord> paymentHistory(AppUser user,String month) {
        teacher(user);
        return repository.payments(user.getId(),parsePaymentMonth(month)).stream().map(TeacherBillingService::payment).toList();
    }
    public static List<PaymentRecord> paymentHistory(TeacherBillingRepository repository,String month) {
        return repository.allPayments(parsePaymentMonth(month)).stream().map(TeacherBillingService::payment).toList();
    }
    private static YearMonth parsePaymentMonth(String month) {
        if(month==null || month.isBlank()) return null;
        if(!month.matches("\\d{4}-(0[1-9]|1[0-2])")) throw WorkspaceError.validation("Месецът трябва да е във формат ГГГГ-ММ.");
        return YearMonth.parse(month);
    }
    private static PaymentRecord payment(Map<String,Object> row) {
        return new PaymentRecord(string(row,"invoice_id"),number(row,"user_id"),string(row,"payment_status"),string(row,"billing_period"),
                number(row,"amount_due"),number(row,"amount_paid"),string(row,"currency"),time(row,"payment_at"),
                row.get("period_start")==null?null:time(row,"period_start"),row.get("period_end")==null?null:time(row,"period_end"));
    }
    private Map<String,Object> priceDescription(String period) {
        if(!period.equals("month")) return Map.of("available",false);
        String priceId=priceId(period);if(!gateway.configured() || priceId.isBlank()) return Map.of("available",false,"amountMinor",MONTHLY_AMOUNT_MINOR,"currency","eur");
        var price=verifiedPrice(period);var result=new LinkedHashMap<String,Object>();result.put("available",true);
        if(price.get("unit_amount") instanceof Number amount) result.put("amountMinor",amount.longValue());
        result.put("currency",string(price,"currency"));return result;
    }
    @Transactional(noRollbackFor=PaymentGateway.Unavailable.class)
    public Map<String,Object> checkout(AppUser user,Checkout request) {
        teacher(user);
        if(request==null || request.requestKey()==null || !request.requestKey().matches("[A-Za-z0-9_-]{8,80}") || !"month".equals(request.period())) throw WorkspaceError.validation("Pro се предлага за 8 € на месец.");
        long workspace=personal.workspace(user);repository.lockTeacher(user.getId());
        var account=account(user.getId(),workspace);sameMode(account);
        if(isPro(user.getId()) || paid(account) || !replaceable(account)) throw WorkspaceError.conflict("Вече имаш Pro достъп или абонамент. Управлявай го през профила си.");
        String price=priceId(request.period());verifiedPrice(request.period());
        String checkoutRequestKey=request.requestKey();
        var previous=repository.findCheckout(user.getId(),checkoutRequestKey);
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
                var row=pending.get();
                if(string(row,"session_id").isBlank()) {
                    if(!string(row,"billing_period").equals(request.period()) || !string(row,"price_id").equals(price)) throw WorkspaceError.conflict("Има неприключила заявка за друго плащане.");
                    if(time(row,"created_at").isBefore(clock.instant().minus(Duration.ofHours(23)))) throw WorkspaceError.conflict("Плащането изисква проверка от поддръжката, преди да се започне ново.");
                    checkoutRequestKey=string(row,"request_key");
                } else {
                    var current=gateway.currentCheckout(string(row,"session_id"));verifyMode(current);
                    if(!string(current,"status").equals("expired")) throw WorkspaceError.conflict("Вече има започнато плащане. Завърши го или изчакай да изтече.");
                    repository.finishCheckout(user.getId(),string(row,"request_key"),"expired");
                    repository.createCheckout(user.getId(),checkoutRequestKey,request.period(),price,clock.instant());
                }
            } else {
                repository.createCheckout(user.getId(),checkoutRequestKey,request.period(),price,clock.instant());
            }
        }
        var session=gateway.teacherCheckout(user.getId(),workspace,price,checkoutRequestKey,string(account,"stripe_customer_id"),frontend);verifyMode(session);
        String id=identifier(string(session,"id"),"cs_");String url=safeUrl(string(session,"url"),"checkout.stripe.com");
        repository.saveCheckout(user.getId(),checkoutRequestKey,id,url);
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
    @Transactional
    public Cancellation cancel(AppUser user) {
        teacher(user);personal.workspace(user);repository.lockTeacher(user.getId());
        var account=repository.findByUserId(user.getId()).orElseThrow(()->WorkspaceError.conflict("Няма абонамент за прекратяване."));sameMode(account);
        String subscription=identifier(string(account,"stripe_subscription_id"),"sub_");
        var current=gateway.currentSubscription(subscription);verifyBoundSubscription(user.getId(),account,current);
        if(Set.of("canceled","incomplete_expired").contains(string(current,"status"))) throw WorkspaceError.conflict("Абонаментът вече е прекратен.");
        if(!flag(current,"cancel_at_period_end")) {
            current=gateway.cancelAtPeriodEnd(subscription);verifyBoundSubscription(user.getId(),account,current);
            if(!flag(current,"cancel_at_period_end")) throw WorkspaceError.conflict("Stripe не потвърди спирането на подновяването. Опитай отново.");
        }
        // Cancellation never grants time or removes access already paid for.
        Instant through=account.get("paid_through")==null?null:time(account,"paid_through");
        repository.update(user.getId(),string(account,"stripe_customer_id"),subscription,string(current,"status"),string(account,"billing_period"),through,true,clock.instant());
        if(!flag(account,"cancel_at_period_end")) audit.write(number(account,"workspace_id"),user.getId(),"teacher_billing.renewal_canceled",null,Map.of("subscription",subscription));
        return new Cancellation(true,through);
    }
    private void verifyBoundSubscription(long user,Map<String,Object> account,Map<String,Object> subscription) {
        verifyMode(subscription);
        if(!string(subscription,"id").equals(string(account,"stripe_subscription_id")) || !reference(subscription.get("customer")).equals(string(account,"stripe_customer_id")) || !string(subscription,"collection_method").equals("charge_automatically")) throw WorkspaceError.forbidden();
        var request=verifiedRequest(user,account,obj(subscription.get("metadata")));
        var item=subscriptionItem(subscription);
        if(!priceIdentifier(item).equals(string(request,"price_id")) || !priceIdentifier(item).equals(priceId(string(request,"billing_period"))) || epoch(item,"quantity")!=1) throw WorkspaceError.forbidden();
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
        if(type.equals("invoice.paid") || type.equals("invoice.payment_failed")) {
            recordPayment(user,object,string(event,"id"),type,epoch(event,"created"),string(request,"billing_period"),price,customer,subscriptionId);
        }
        Instant through=account.get("paid_through")==null?null:time(account,"paid_through");
        String latest=reference(current.get("latest_invoice"));
        if(!latest.isBlank()) through=paidInvoiceThrough(gateway.currentInvoice(identifier(latest,"in_")),subscriptionId,customer,price,through);
        // An older paid renewal may arrive after the current invoice failed; only its paid line can extend access.
        if(type.equals("invoice.paid") && !string(object,"id").equals(latest)) through=paidInvoiceThrough(gateway.currentInvoice(identifier(string(object,"id"),"in_")),subscriptionId,customer,price,through);
        repository.update(user,customer,subscriptionId,string(current,"status"),string(request,"billing_period"),through,flag(current,"cancel_at_period_end"),clock.instant());
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
    private void recordPayment(long user,Map<String,Object> eventInvoice,String eventId,String eventType,long eventCreated,String period,String price,String customer,String subscription) {
        String invoiceId=identifier(string(eventInvoice,"id"),"in_");
        var invoice=gateway.currentInvoice(invoiceId);verifyMode(invoice);
        if(!invoiceId.equals(string(invoice,"id")) || !subscriptionId(invoice).equals(subscription) || !reference(invoice.get("customer")).equals(customer))
            throw WorkspaceError.forbidden();
        Instant periodStart=null,periodEnd=null;
        Object rawLines=obj(invoice.get("lines")).get("data");
        if(rawLines instanceof List<?> lines) for(Object raw:lines) {
            var line=obj(raw);if(!priceIdentifier(line).equals(price)) continue;
            var bounds=obj(line.get("period"));long start=epoch(bounds,"start"),end=epoch(bounds,"end");
            if(start>0 && end>start) {periodStart=Instant.ofEpochSecond(start);periodEnd=Instant.ofEpochSecond(end);break;}
        }
        if(periodStart==null || periodEnd==null) throw WorkspaceError.validation("Липсва период за фактурата от Stripe.");
        Instant providerEventAt=Instant.ofEpochSecond(eventCreated);
        var existing=repository.findPayment(invoiceId);
        String status=eventType.equals("invoice.paid")?"paid":"failed";
        if(existing.isPresent()) {
            var row=existing.get();
            if(string(row,"payment_status").equals("paid") && status.equals("failed")) return;
            if(time(row,"provider_event_at").isAfter(providerEventAt)) return;
        }
        if(!(invoice.get("amount_due") instanceof Number due) || !(invoice.get("amount_paid") instanceof Number paid)
                || !string(invoice,"currency").matches("[A-Za-z]{3}")) throw WorkspaceError.validation("Невалидни данни във фактурата от Stripe.");
        repository.savePayment(invoiceId,user,eventId,eventType,status,period,due.longValue(),paid.longValue(),string(invoice,"currency").toUpperCase(Locale.ROOT),
                providerEventAt,periodStart,periodEnd,providerEventAt,clock.instant());
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
        long expectedAmount=period.equals("month")?MONTHLY_AMOUNT_MINOR:5000;
        if(!string(price,"id").equals(id) || !flag(price,"active") || !string(price,"type").equals("recurring") || !string(recurring,"interval").equals(period) || epoch(recurring,"interval_count")!=1 || !string(price,"billing_scheme").equals("per_unit") || !(price.get("unit_amount") instanceof Number amount) || amount.longValue()!=expectedAmount || !string(price,"currency").equalsIgnoreCase("eur")) throw WorkspaceError.conflict("Настрой Stripe с цена €"+(expectedAmount/100)+" EUR за "+(period.equals("month")?"месец":"година")+" и опитай отново.");
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
    public record Cancellation(boolean cancelAtPeriodEnd,Instant paidThrough) {}
    public record PaymentRecord(String invoiceId,long userId,String status,String billingPeriod,long amountDue,long amountPaid,String currency,
                                Instant paymentAt,Instant periodStart,Instant periodEnd) {}
}
