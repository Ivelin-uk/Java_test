package com.quicktest.ai;

import com.quicktest.tests.QuizDtos;

public interface AiProvider {
    GeneratedTest generateTest(GenerateTestRequest request);
    default GradedAnswers gradeAnswers(GradeAnswersRequest request) {
        throw new UnsupportedOperationException("AI grading is not supported by this provider");
    }

    record GenerateTestRequest(String topic, String instructions, String language, int questionCount, String difficulty, java.util.List<String> questionTypes, java.util.Map<String,Integer> difficultyCounts) {
        public GenerateTestRequest(String topic,String instructions,String language,int questionCount,String difficulty) {this(topic,instructions,language,questionCount,difficulty,null,null);}
    }
    record GeneratedTest(QuizDtos.TestRequest test, String model, int inputTokens, int outputTokens) {}
    record GradingQuestion(long id, String type, String question, java.math.BigDecimal maximumPoints,
                           String criteria, java.util.List<String> acceptedAnswers, String explanation, String answer) {}
    record GradeAnswersRequest(String language, java.util.List<GradingQuestion> questions) {}
    record AnswerGrade(long questionId, java.math.BigDecimal points, String comment) {}
    record GradedAnswers(java.util.List<AnswerGrade> grades, String model, int inputTokens, int outputTokens) {}
}
