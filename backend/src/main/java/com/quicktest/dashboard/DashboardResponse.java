package com.quicktest.dashboard;

public record DashboardResponse(long totalTests, long activeTests, long draftTests, long attempts, long aiGenerations) {}
