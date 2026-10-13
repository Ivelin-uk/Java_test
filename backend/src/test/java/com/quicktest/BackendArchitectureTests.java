package com.quicktest;

import com.sun.source.tree.*;
import com.sun.source.util.JavacTask;
import com.sun.source.util.TreeScanner;
import org.junit.jupiter.api.Test;

import javax.tools.ToolProvider;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.*;

class BackendArchitectureTests {
    private static final Path SOURCES = Path.of("src/main/java/com/quicktest");
    private static final Pattern SQL = Pattern.compile("(?is)^(SELECT|INSERT|UPDATE|DELETE|WITH)\\s+.*");

    private List<CompilationUnitTree> sources() throws Exception {
        var compiler = ToolProvider.getSystemJavaCompiler();
        assertNotNull(compiler, "Architecture tests require the project's JDK");
        try (var files = Files.walk(SOURCES); var manager = compiler.getStandardFileManager(null, null, null)) {
            var units = manager.getJavaFileObjectsFromPaths(files.filter(path -> path.toString().endsWith(".java")).toList());
            var task = (JavacTask) compiler.getTask(null, manager, null, List.of("-proc:none"), null, units);
            var parsed = new ArrayList<CompilationUnitTree>();
            task.parse().forEach(parsed::add);
            return parsed;
        }
    }

    private String filename(CompilationUnitTree unit) {
        return Path.of(unit.getSourceFile().toUri()).getFileName().toString();
    }

    @Test void persistenceIsConfinedToRepositories() throws Exception {
        var violations = new ArrayList<String>();
        for (var unit : sources()) {
            String file = filename(unit);
            if (file.endsWith("Repository.java") || file.equals("WorkspaceStore.java")) continue;
            for (var imported : unit.getImports()) {
                String dependency = imported.getQualifiedIdentifier().toString();
                if (dependency.contains(".jdbc.") || dependency.contains(".WorkspaceStore") || dependency.contains(".EntityManager")
                        || dependency.equals("javax.sql.DataSource")) violations.add(file + " imports persistence API " + dependency);
            }
            new TreeScanner<Void, Void>() {
                @Override public Void visitLiteral(LiteralTree tree, Void unused) {
                    if (tree.getValue() instanceof String value && SQL.matcher(value.stripLeading()).matches()) violations.add(file + " declares SQL outside a repository");
                    return super.visitLiteral(tree, unused);
                }
            }.scan(unit, null);
        }
        assertEquals(List.of(), violations);
    }

    @Test void controllersDelegateWithoutPersistenceOrBusinessExceptions() throws Exception {
        var violations = new ArrayList<String>();
        for (var unit : sources()) {
            String file = filename(unit);
            if (!file.endsWith("Controller.java")) continue;
            for (var imported : unit.getImports()) {
                String dependency = imported.getQualifiedIdentifier().toString();
                if (dependency.contains("Repository") || dependency.contains(".repository.") || dependency.contains(".Transactional")) violations.add(file + " imports " + dependency);
            }
            new TreeScanner<Void, Void>() {
                @Override public Void visitThrow(ThrowTree tree, Void unused) {
                    violations.add(file + " throws a business exception instead of delegating to its service");
                    return super.visitThrow(tree, unused);
                }
            }.scan(unit, null);
        }
        assertEquals(List.of(), violations);
    }

    @Test void repositoriesNeverDependOnControllersOrServices() throws Exception {
        var violations = new ArrayList<String>();
        for (var unit : sources()) {
            String file = filename(unit);
            if (!file.endsWith("Repository.java")) continue;
            for (var imported : unit.getImports()) {
                String dependency = imported.getQualifiedIdentifier().toString();
                if (dependency.endsWith("Service") || dependency.contains("Controller") || dependency.endsWith(".OrgAccess")) violations.add(file + " depends on upper layer " + dependency);
            }
        }
        assertEquals(List.of(), violations);
    }
}
