package com.quicktest.workspace;

/** A provider explicitly rejected the request before accepting any message. */
public class MailDeliveryRejected extends org.springframework.mail.MailException {
    public MailDeliveryRejected() {super("Mail provider rejected the delivery request");}
}
