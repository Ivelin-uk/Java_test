package com.quicktest.workspace;

import java.util.Map;

public interface MailGateway {
    String send(long notification,String recipient,Map<String,Object> payload);
}
