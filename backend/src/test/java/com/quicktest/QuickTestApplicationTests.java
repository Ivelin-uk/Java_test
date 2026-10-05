package com.quicktest;

import com.quicktest.auth.AppUserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import static org.junit.jupiter.api.Assertions.assertFalse;

@SpringBootTest
class QuickTestApplicationTests {

	@Autowired
	AppUserRepository users;

	@Test
	void contextLoads() {
		assertFalse(users.existsByEmailIgnoreCase("demo@quicktest.local"));
	}

}
