package com.quicktest.workspace;

import java.util.Map;

public interface PaymentGateway {
    class Unavailable extends WorkspaceError {
        public Unavailable() {super(org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE,"payment_provider_unavailable","Платежната услуга временно не е достъпна. Опитай отново със същата заявка.");}
    }
    boolean configured();
    default String mode() { return "test"; }
    Map<String,Object> checkout(long organization,String price,String requestKey,String returnUrl);
    Map<String,Object> currentSubscription(String id);
    default Map<String,Object> teacherCheckout(long user,long workspace,String price,String requestKey,String customer,String returnUrl) {throw WorkspaceError.conflict("Stripe не е конфигуриран.");}
    default Map<String,Object> currentCheckout(String id) {throw WorkspaceError.conflict("Stripe не е конфигуриран.");}
    default Map<String,Object> currentInvoice(String id) {throw WorkspaceError.conflict("Stripe не е конфигуриран.");}
    default Map<String,Object> currentPrice(String id) {throw WorkspaceError.conflict("Stripe не е конфигуриран.");}
    default Map<String,Object> portal(String customer,String returnUrl) {throw WorkspaceError.conflict("Платежният портал не е конфигуриран.");}
    default Map<String,Object> cancelAtPeriodEnd(String subscription) {throw WorkspaceError.conflict("Stripe не е конфигуриран.");}
    Map<String,Object> verifyWebhook(String payload,String signature);
}
