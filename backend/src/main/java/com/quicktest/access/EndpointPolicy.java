package com.quicktest.access;

import java.lang.annotation.*;

@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
public @interface EndpointPolicy {
    Mode mode() default Mode.MANAGED;
    boolean teacher() default true;
    boolean student() default false;
    boolean paid() default false;

    enum Mode { MANAGED, PUBLIC, PROFILE, ADMIN }
}
