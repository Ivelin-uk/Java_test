package com.quicktest.workspace;

import java.util.Map;

public interface PaymentGateway {
    boolean configured();
    Map<String,Object> checkout(long organization,String price,String requestKey,String returnUrl);
    Map<String,Object> currentSubscription(String id);
    default Map<String,Object> portal(String customer,String returnUrl) {throw WorkspaceError.conflict("Платежният портал не е конфигуриран.");}
    Map<String,Object> verifyWebhook(String payload,String signature);
}
