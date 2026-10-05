package com.quicktest.ai;

import com.quicktest.auth.AppUser;
import com.quicktest.tests.QuizDtos;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;

@Service
public class AiService {
    private final AiProvider provider;
    private final AiUsageRepository usageRepository;

    public AiService(AiProvider provider, AiUsageRepository usageRepository) {
        this.provider = provider;
        this.usageRepository = usageRepository;
    }

    @Transactional
    public AiGeneratedTestResponse generateTest(AppUser user, @Valid AiGenerateTestRequest request) {
        AiProvider.GeneratedTest generated = provider.generateTest(new AiProvider.GenerateTestRequest(
                request.topic(),
                request.instructions(),
                request.language() == null ? "Bulgarian" : request.language(),
                request.questionCount(),
                request.difficulty() == null ? "MEDIUM" : request.difficulty()
        ));

        AiUsage usage = new AiUsage();
        usage.setUser(user);
        usage.setOperation("generate_test");
        usage.setModel(generated.model());
        usage.setInputTokens(generated.inputTokens());
        usage.setOutputTokens(generated.outputTokens());
        usage.setEstimatedCost(BigDecimal.ZERO);
        usageRepository.save(usage);
        return new AiGeneratedTestResponse(generated.test(), generated.model(), generated.inputTokens(), generated.outputTokens());
    }

    public record AiGenerateTestRequest(
            @NotBlank @Size(max = 500) String topic,
            @Size(max = 2000) String instructions,
            @Size(max = 100) String language,
            @Min(1) @Max(20) int questionCount,
            @Pattern(regexp = "EASY|MEDIUM|HARD|MIXED") String difficulty
    ) {}

    public record AiGeneratedTestResponse(QuizDtos.TestRequest test, String model, int inputTokens, int outputTokens) {}
}
