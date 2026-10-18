package com.quicktest;

import com.quicktest.exception.ApiException;
import com.quicktest.workspace.OrgAccess;
import com.quicktest.workspace.SourceMaterialService;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.encryption.AccessPermission;
import org.apache.pdfbox.pdmodel.encryption.StandardProtectionPolicy;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.HttpStatus;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.junit.jupiter.api.Assertions.*;

class SourceMaterialTests {
    private final SourceMaterialService service = new SourceMaterialService();
    private final OrgAccess.Scope teacher = new OrgAccess.Scope(1, 2, Set.of("TEACHER"));

    @Test void extractsUtf8LectureAndReportsReadableCharacters() {
        String lecture = "Основи на Java\nКласът описва състояние и поведение.";
        var result = extract("Лекция.txt", lecture.getBytes(StandardCharsets.UTF_8));
        assertEquals("Лекция.txt", result.fileName());
        assertEquals(lecture, result.sourceText());
        assertEquals(result.sourceText().length(), result.characterCount());
    }

    @Test void extractsAllSlidesInPresentationOrderRatherThanZipOrder() throws Exception {
        var entries = new LinkedHashMap<String, String>();
        entries.put("ppt/slides/slide10.xml", slide("Последен слайд"));
        entries.put("ppt/slides/slide2.xml", slide("Втори слайд"));
        entries.put("ppt/slides/slide1.xml", slide("Първи &amp; основен слайд"));
        entries.put("ppt/notesSlides/notesSlide1.xml", slide("PRIVATE_NOTES_FIXTURE"));
        var result = extract("Java.PPTX", zip(entries));
        String text = result.sourceText();
        assertTrue(text.contains("Първи & основен слайд"));
        assertTrue(text.indexOf("Първи") < text.indexOf("Втори"));
        assertTrue(text.indexOf("Втори") < text.indexOf("Последен"));
        assertEquals(text.length(), result.characterCount());
    }

    @Test void extractsDocxParagraphsAndKeepsWordsSeparated() throws Exception {
        String document = """
                <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
                  <w:body><w:p><w:r><w:t>Лекция за Java.</w:t></w:r></w:p>
                    <w:p><w:r><w:t>Втори абзац.</w:t></w:r></w:p></w:body>
                </w:document>
                """;
        String text = extract("lecture.docx", zip(Map.of("word/document.xml", document))).sourceText();
        assertTrue(text.contains("Лекция за Java."));
        assertTrue(text.contains("Втори абзац."));
        assertFalse(text.contains("Java.Втори"));
    }

    @Test void honorsRearrangedPresentationOrderAndIgnoresUnreferencedSlidesAndExternalTargets() throws Exception {
        var entries = new LinkedHashMap<String, String>();
        entries.put("ppt/slides/slide1.xml", slide("Последна тема"));
        entries.put("ppt/slides/slide2.xml", slide("Първа тема"));
        entries.put("ppt/slides/slide3.xml", slide("UNREFERENCED_SLIDE_FIXTURE"));
        entries.put("ppt/presentation.xml", """
                <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
                  <p:sldIdLst><p:sldId id="256" r:id="second"/><p:sldId id="257" r:id="external"/>
                    <p:sldId id="258" r:id="first"/></p:sldIdLst>
                </p:presentation>
                """);
        entries.put("ppt/_rels/presentation.xml.rels", """
                <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                  <Relationship Id="first" Target="slides/slide1.xml"
                    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"/>
                  <Relationship Id="second" Target="/ppt/slides/slide2.xml"
                    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"/>
                  <Relationship Id="external" Target="slides/slide3.xml" TargetMode="External"
                    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"/>
                </Relationships>
                """);
        String text = extract("rearranged.pptx", zip(entries)).sourceText();
        assertTrue(text.contains("Първа тема"));
        assertTrue(text.indexOf("Първа тема") < text.indexOf("Последна тема"));
        assertFalse(text.contains("UNREFERENCED_SLIDE_FIXTURE"));
    }

    @Test void extractsReadablePdfText() throws Exception {
        String text = extract("lecture.pdf", pdf(1, "Java classes contain fields and methods.", false)).sourceText();
        assertTrue(text.contains("Java classes contain fields and methods."));
    }

    @Test void requiresTeachingRoleEvenForPlatformScopes() {
        var upload = upload("lecture.txt", "Lecture".getBytes(StandardCharsets.UTF_8));
        for (var scope : new OrgAccess.Scope[]{new OrgAccess.Scope(1, 2, Set.of("STUDENT")),
                new OrgAccess.Scope(1, 2, Set.of("STUDENT"), true),
                new OrgAccess.Scope(1, 2, Set.of(), true)}) {
            assertEquals(HttpStatus.FORBIDDEN, assertThrows(ApiException.class, () -> service.extract(scope, upload)).getStatusCode());
        }
        assertEquals("Lecture", service.extract(new OrgAccess.Scope(1, 2, Set.of("ORG_ADMIN")), upload).sourceText());
    }

    @Test void rejectsUnsupportedMalformedOrEmptyUploads() throws Exception {
        assertBadRequest(() -> extract("lecture.exe", "Lecture".getBytes(StandardCharsets.UTF_8)));
        assertBadRequest(() -> service.extract(teacher, new SourceMaterialService.Upload("lecture.txt", "%%%")));
        assertBadRequest(() -> extract("lecture.txt", new byte[0]));
        assertBadRequest(() -> extract("lecture.txt", " \n\t ".getBytes(StandardCharsets.UTF_8)));
        assertBadRequest(() -> extract("lecture.txt", new byte[]{(byte) 0xc3, (byte) 0x28}));
        assertBadRequest(() -> extract("lecture.pptx", "not a zip".getBytes(StandardCharsets.UTF_8)));
        assertBadRequest(() -> extract("lecture.pdf", "not a PDF".getBytes(StandardCharsets.UTF_8)));
        assertBadRequest(() -> extract("lecture.docx", zip(Map.of("word/document.xml", "<broken"))));
    }

    @Test void rejectsFilesOverUploadLimitAndTextOverExtractionLimit() {
        assertBadRequest(() -> extract("large.txt", new byte[8 * 1024 * 1024 + 1]));
        assertBadRequest(() -> extract("large.txt", "a".repeat(100001).getBytes(StandardCharsets.UTF_8)));
        assertEquals(100000, extract("limit.txt", "a".repeat(100000).getBytes(StandardCharsets.UTF_8)).characterCount());
    }

    @Test void rejectsOfficeFilesWithoutReadableLectureContent() throws Exception {
        assertBadRequest(() -> extract("empty.pptx", zip(Map.of("ppt/slides/slide1.xml", slide(" ")))));
        assertBadRequest(() -> extract("empty.docx", zip(Map.of("word/document.xml", "<document/>"))));
        assertBadRequest(() -> extract("wrong-format.pptx", zip(Map.of("word/document.xml", "<document>Lecture</document>"))));
    }

    @Test void rejectsXmlEntitiesWithoutReadingLocalFiles(@TempDir Path directory) throws Exception {
        Path privateFile = directory.resolve("private.txt");
        Files.writeString(privateFile, "PRIVATE_ENTITY_FIXTURE", StandardCharsets.UTF_8);
        String document = """
                <!DOCTYPE w:document [<!ENTITY secret SYSTEM "%s">]>
                <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
                  <w:body><w:p><w:r><w:t>&secret;</w:t></w:r></w:p></w:body>
                </w:document>
                """.formatted(privateFile.toUri());
        assertBadRequest(() -> extract("lecture.docx", zip(Map.of("word/document.xml", document))));
        String presentation = "<!DOCTYPE p:sld [<!ENTITY secret 'INJECTED_ENTITY_FIXTURE'>]>" + slide("&secret;");
        assertBadRequest(() -> extract("lecture.pptx", zip(Map.of("ppt/slides/slide1.xml", presentation))));
    }

    @Test void rejectsZipEntryFloodsAndExcessiveInflation() throws Exception {
        var entries = new LinkedHashMap<String, String>();
        for (int index = 0; index < 1000; index++) entries.put("unrelated/" + index, "");
        entries.put("ppt/slides/slide1.xml", slide("Lecture"));
        assertBadRequest(() -> extract("entries.pptx", zip(entries)));
        assertBadRequest(() -> extract("inflated.pptx", zip(Map.of("unrelated/padding.bin", "x".repeat(32 * 1024 * 1024 + 1),
                "ppt/slides/slide1.xml", slide("Lecture")))));
    }

    @Test void rejectsEncryptedEmptyAndOverlongPdfDocuments() throws Exception {
        assertBadRequest(() -> extract("encrypted.pdf", pdf(1, "Private lecture", true)));
        assertBadRequest(() -> extract("blank.pdf", pdf(1, null, false)));
        assertBadRequest(() -> extract("too-many-pages.pdf", pdf(201, "Lecture", false)));
    }

    private SourceMaterialService.Material extract(String name, byte[] bytes) {
        return service.extract(teacher, upload(name, bytes));
    }

    private SourceMaterialService.Upload upload(String name, byte[] bytes) {
        return new SourceMaterialService.Upload(name, Base64.getEncoder().encodeToString(bytes));
    }

    private void assertBadRequest(org.junit.jupiter.api.function.Executable action) {
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(ApiException.class, action).getStatusCode());
    }

    private static String slide(String text) {
        return "<p:sld xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\" "
                + "xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\"><p:cSld><p:spTree>"
                + "<p:sp><p:txBody><a:p><a:r><a:t>" + text + "</a:t></a:r></a:p></p:txBody></p:sp>"
                + "</p:spTree></p:cSld></p:sld>";
    }

    private static byte[] zip(Map<String, String> entries) throws Exception {
        var bytes = new ByteArrayOutputStream();
        try (var zip = new ZipOutputStream(bytes, StandardCharsets.UTF_8)) {
            for (var entry : entries.entrySet()) {
                zip.putNextEntry(new ZipEntry(entry.getKey()));
                zip.write(entry.getValue().getBytes(StandardCharsets.UTF_8));
                zip.closeEntry();
            }
        }
        return bytes.toByteArray();
    }

    private static byte[] pdf(int pages, String text, boolean encrypted) throws Exception {
        var bytes = new ByteArrayOutputStream();
        try (var document = new PDDocument()) {
            for (int index = 0; index < pages; index++) {
                var page = new PDPage();
                document.addPage(page);
                if (text != null && index == 0) {
                    try (var content = new PDPageContentStream(document, page)) {
                        content.beginText();
                        content.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 12);
                        content.newLineAtOffset(50, 700);
                        content.showText(text);
                        content.endText();
                    }
                }
            }
            if (encrypted) document.protect(new StandardProtectionPolicy("owner-secret", "reader-secret", new AccessPermission()));
            document.save(bytes);
        }
        return bytes.toByteArray();
    }
}
