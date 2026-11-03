package com.quicktest.workspace;

import java.text.Normalizer;
import java.util.Locale;

final class SubjectNames {
    private SubjectNames() {}

    static String clean(String value) {
        return Normalizer.normalize(value == null ? "" : value, Normalizer.Form.NFKC).replaceAll("(?U)\\s+", " ").strip();
    }

    static String key(String value) { return clean(value).toLowerCase(Locale.ROOT); }

    static String name(String value) {
        String name = clean(value);
        if (name.isEmpty() || name.length() > 190 || key(name).length() > 190 || name.chars().anyMatch(Character::isISOControl))
            throw WorkspaceError.validation("Името трябва да съдържа от 1 до 190 символа.");
        return name;
    }

    static String level(String value) {
        String level = clean(value);
        if (!level.isEmpty() && !level.matches("[1-9]|1[0-2]"))
            throw WorkspaceError.validation("Изберете клас от 1. до 12. или обща тема без клас.");
        return level;
    }
}
