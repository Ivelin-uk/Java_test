package com.quicktest;

import com.quicktest.workspace.StripeTestGateway;
import com.quicktest.workspace.WorkspaceJson;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.*;
import static org.springframework.test.web.client.response.MockRestResponseCreators.*;

class StripeGatewayTests {
    @Test void checkoutCollectsPaymentDetailsForRecurringBillingWithDashboardManagedWallets() {
        var builder=RestClient.builder();var server=MockRestServiceServer.bindTo(builder).build();
        var gateway=new StripeTestGateway(new WorkspaceJson(new ObjectMapper()),"sk_test_fixture","whsec_fixture","test",builder);
        var form=new LinkedMultiValueMap<String,String>();
        form.add("mode","subscription");form.add("line_items[0][price]","price_month");form.add("line_items[0][quantity]","1");
        form.add("payment_method_collection","always");
        for(String prefix:java.util.List.of("metadata","subscription_data[metadata]")) {
            form.add(prefix+"[billing_owner]","teacher");form.add(prefix+"[teacher_id]","101");form.add(prefix+"[workspace_id]","201");form.add(prefix+"[request_key]","request_fixture");
        }
        form.add("client_reference_id","101");form.add("customer","cus_fixture");
        form.add("success_url","https://exam.example/billing?checkout=success");form.add("cancel_url","https://exam.example/billing?checkout=canceled");
        // Exact form matching ensures payment_method_types is omitted so Stripe can offer enabled wallets.
        server.expect(requestTo("https://api.stripe.com/v1/checkout/sessions")).andExpect(method(HttpMethod.POST))
                .andExpect(header("Idempotency-Key","teacher-101-request_fixture")).andExpect(content().formData(form))
                .andRespond(withSuccess("{\"id\":\"cs_fixture\",\"url\":\"https://checkout.stripe.com/c/pay/fixture\"}",MediaType.APPLICATION_JSON));
        assertEquals("cs_fixture",gateway.teacherCheckout(101,201,"price_month","request_fixture","cus_fixture","https://exam.example").get("id"));
        server.verify();
    }
    @Test void cancellationSchedulesPeriodEndWithoutDeletingSubscriptionOrChangingPrice() {
        var builder=RestClient.builder();var server=MockRestServiceServer.bindTo(builder).build();
        var gateway=new StripeTestGateway(new WorkspaceJson(new ObjectMapper()),"sk_test_fixture","whsec_fixture","test",builder);
        var form=new LinkedMultiValueMap<String,String>();form.add("cancel_at_period_end","true");
        server.expect(requestTo("https://api.stripe.com/v1/subscriptions/sub_fixture")).andExpect(method(HttpMethod.POST)).andExpect(content().formData(form))
                .andRespond(withSuccess("{\"id\":\"sub_fixture\",\"cancel_at_period_end\":true}",MediaType.APPLICATION_JSON));
        assertEquals(true,gateway.cancelAtPeriodEnd("sub_fixture").get("cancel_at_period_end"));
        server.verify();
    }
}
