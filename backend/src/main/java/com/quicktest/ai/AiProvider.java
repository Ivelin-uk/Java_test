package com.quicktest.ai;

import com.quicktest.tests.QuizDtos;

public interface AiProvider {
    GeneratedTest generateTest(GenerateTestRequest request);

    record GenerateTestRequest(String topic, String instructions, String language, int questionCount, String difficulty) {}
    record GeneratedTest(QuizDtos.TestRequest test, String model, int inputTokens, int outputTokens) {}
}
