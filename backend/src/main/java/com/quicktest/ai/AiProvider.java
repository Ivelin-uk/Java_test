package com.quicktest.ai;

import com.quicktest.tests.QuizDtos;

public interface AiProvider {
    GeneratedTest generateTest(GenerateTestRequest request);

    record GenerateTestRequest(String topic, String instructions, String language, int questionCount, String difficulty, java.util.List<String> questionTypes, java.util.Map<String,Integer> difficultyCounts) {
        public GenerateTestRequest(String topic,String instructions,String language,int questionCount,String difficulty) {this(topic,instructions,language,questionCount,difficulty,null,null);}
    }
    record GeneratedTest(QuizDtos.TestRequest test, String model, int inputTokens, int outputTokens) {}
}
