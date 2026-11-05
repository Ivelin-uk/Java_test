package com.quicktest.ai;

import com.quicktest.tests.QuizDtos;

public interface AiProvider {
    GeneratedTest generateTest(GenerateTestRequest request);
    default ImportedTest importTestDocument(ImportTestDocumentRequest request) {
        throw new com.quicktest.exception.ApiException(org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE,
                "Избраният AI доставчик не поддържа разпознаване на тестове от файл.");
    }
    default ExtractedSyllabus extractSyllabus(ExtractSyllabusRequest request) {
        throw new UnsupportedOperationException("Syllabus extraction is not supported by this provider");
    }
    default GeneratedImage generateImage(GenerateImageRequest request) {
        throw new UnsupportedOperationException("AI image generation is not supported by this provider");
    }
    default GradedAnswers gradeAnswers(GradeAnswersRequest request) {
        throw new UnsupportedOperationException("AI grading is not supported by this provider");
    }

    record GenerateTestRequest(String topic, String instructions, String language, int questionCount, String difficulty, java.util.List<String> questionTypes, java.util.Map<String,Integer> difficultyCounts, int imageCount) {
        public GenerateTestRequest(String topic,String instructions,String language,int questionCount,String difficulty,java.util.List<String> questionTypes,java.util.Map<String,Integer> difficultyCounts) {this(topic,instructions,language,questionCount,difficulty,questionTypes,difficultyCounts,0);}
        public GenerateTestRequest(String topic,String instructions,String language,int questionCount,String difficulty) {this(topic,instructions,language,questionCount,difficulty,null,null);}
    }
    record GeneratedTest(QuizDtos.TestRequest test, String model, int inputTokens, int outputTokens, java.util.List<String> imagePrompts) {
        public GeneratedTest(QuizDtos.TestRequest test,String model,int inputTokens,int outputTokens) {this(test,model,inputTokens,outputTokens,java.util.List.of());}
    }
    record ExtractSyllabusRequest(String text, String fileName, String fileData) {
        public ExtractSyllabusRequest(String text) { this(text, null, null); }
    }
    record ExtractedSyllabus(String subject, java.util.List<String> topics, String model, int inputTokens, int outputTokens) {}
    record ImportTestDocumentRequest(String text, String fileName, String mediaType, String fileData) {}
    record ImportedTest(com.quicktest.workspace.AssessmentService.Definition definition, java.util.List<String> warnings,
                        String model, int inputTokens, int outputTokens) {}
    record GenerateImageRequest(String prompt, String language) {}
    record GeneratedImage(String base64, String model, int inputTokens, int outputTokens) {}
    record GradingQuestion(long id, String type, String question, java.math.BigDecimal maximumPoints,
                           String criteria, java.util.List<String> acceptedAnswers, String explanation, String answer) {}
    record GradeAnswersRequest(String language, java.util.List<GradingQuestion> questions) {}
    record AnswerGrade(long questionId, java.math.BigDecimal points, String comment) {}
    record GradedAnswers(java.util.List<AnswerGrade> grades, String model, int inputTokens, int outputTokens) {}
}
