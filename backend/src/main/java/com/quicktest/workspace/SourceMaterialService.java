package com.quicktest.workspace;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
import org.springframework.stereotype.Service;
import org.xml.sax.Attributes;
import org.xml.sax.SAXException;
import org.xml.sax.helpers.DefaultHandler;

import javax.xml.XMLConstants;
import javax.xml.parsers.SAXParserFactory;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.zip.ZipInputStream;

/** Extracts teacher-provided learning material without storing or executing the uploaded file. */
@Service
public class SourceMaterialService {
    public static final int MAX_FILE_BYTES = 8 * 1024 * 1024;
    public static final int MAX_TEXT_LENGTH = 100_000;
    private static final int MAX_BASE64_LENGTH = ((MAX_FILE_BYTES + 2) / 3) * 4;
    private static final int MAX_EXPANDED_BYTES = 32 * 1024 * 1024;
    private static final int MAX_XML_BYTES = 4 * 1024 * 1024;
    private static final Set<String> FORMATS = Set.of("pdf", "pptx", "docx", "txt");
    public static final int MAX_TEST_PDF_PAGES = 50;
    public static final int MAX_TEST_IMAGE_PIXELS = 24_000_000;

    /** Validates files locally; only PDF pages and canonical raster bytes need vision input. */
    public TestDocument prepareTestDocument(OrgAccess.Scope scope, Upload request) {
        DecodedUpload upload = decode(scope, request, Set.of("pdf", "docx", "png", "jpg", "jpeg"));
        try {
            if (upload.format().equals("docx")) {
                if (upload.bytes().length < 4 || upload.bytes()[0] != 'P' || upload.bytes()[1] != 'K'
                        || upload.bytes()[2] != 3 || upload.bytes()[3] != 4) throw WorkspaceError.validation("Невалиден Word документ.");
                String text = normalizeText(officeText(upload.bytes(), "docx"));
                if (text.isBlank()) throw WorkspaceError.validation("Word документът няма четим текст. Запазете го като PDF или качете снимка.");
                return new TestDocument(upload.fileName(), text, "text/plain", "");
            }
            if (upload.format().equals("pdf")) {
                if (upload.bytes().length < 5 || !new String(upload.bytes(), 0, 5, StandardCharsets.US_ASCII).equals("%PDF-"))
                    throw WorkspaceError.validation("Невалиден PDF документ.");
                try (var document = Loader.loadPDF(upload.bytes())) {
                    if (document.isEncrypted()) throw WorkspaceError.validation("Изберете PDF без защита с парола.");
                    if (document.getNumberOfPages() < 1 || document.getNumberOfPages() > MAX_TEST_PDF_PAGES)
                        throw WorkspaceError.validation("Тестът в PDF трябва да е от 1 до 50 страници.");
                }
                return new TestDocument(upload.fileName(), normalizeText(pdfText(upload.bytes())), "application/pdf",
                        Base64.getEncoder().encodeToString(upload.bytes()));
            }
            boolean png = upload.format().equals("png");
            byte[] bytes = upload.bytes();
            boolean signature = png ? bytes.length >= 8 && Arrays.equals(Arrays.copyOf(bytes, 8),
                    new byte[]{(byte)137,80,78,71,13,10,26,10}) : bytes.length >= 3 && bytes[0] == (byte)255 && bytes[1] == (byte)216 && bytes[2] == (byte)255;
            if (!signature) throw WorkspaceError.validation("Форматът на снимката не съответства на PNG/JPEG файла.");
            try (var input = javax.imageio.ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
                var readers = javax.imageio.ImageIO.getImageReaders(input);
                if (!readers.hasNext()) throw WorkspaceError.validation("Снимката не може да бъде прочетена.");
                var imageReader = readers.next();
                try {
                    imageReader.setInput(input);
                    String format = imageReader.getFormatName().toLowerCase(Locale.ROOT);
                    int width = imageReader.getWidth(0), height = imageReader.getHeight(0);
                    if (!format.equals(png ? "png" : "jpeg") || width < 1 || height < 1 || width > 8192 || height > 8192
                            || (long)width * height > MAX_TEST_IMAGE_PIXELS)
                        throw WorkspaceError.validation("Снимката трябва да е PNG/JPEG до 8192 px и 24 MP.");
                    var output = new ByteArrayOutputStream();
                    if (!javax.imageio.ImageIO.write(imageReader.read(0), format, output) || output.size() > MAX_FILE_BYTES)
                        throw WorkspaceError.validation("Обработената снимка трябва да е до 8 MB. Изберете JPEG или намалете размера.");
                    return new TestDocument(upload.fileName(), "", "image/" + format, Base64.getEncoder().encodeToString(output.toByteArray()));
                } finally { imageReader.dispose(); }
            }
        } catch (WorkspaceError error) { throw error; }
        catch (Exception error) { throw WorkspaceError.validation("Файлът не може да бъде прочетен. Проверете формата и премахнете защитата с парола."); }
    }

    public Material extract(OrgAccess.Scope scope, Upload request) {
        DecodedUpload upload = decode(scope, request, FORMATS);
        String text;
        try {
            text = switch (upload.format()) {
                case "txt" -> plainText(upload.bytes());
                case "pdf" -> pdfText(upload.bytes());
                default -> officeText(upload.bytes(), upload.format());
            };
        } catch (WorkspaceError error) { throw error; }
        catch (Exception error) { throw WorkspaceError.validation("Файлът не може да бъде прочетен. Проверете формата и премахнете защитата с парола."); }
        text = normalizeText(text);
        if (text.isBlank()) throw WorkspaceError.validation("Във файла няма разпознаваем текст. За сканиран материал използвайте версия с избираем текст.");
        if (text.length() > MAX_TEXT_LENGTH) throw textLimit();
        return new Material(upload.fileName(), text, text.length());
    }

    public SyllabusMaterial prepareSyllabus(OrgAccess.Scope scope, Upload request) {
        DecodedUpload upload = decode(scope, request, Set.of("pdf", "docx"));
        String text = "";
        try {
            if (upload.format().equals("pdf")) {
                validatePdf(upload.bytes());
                text = normalizeText(pdfText(upload.bytes()));
            } else {
                text = normalizeText(officeText(upload.bytes(), upload.format()));
                if (text.isBlank()) throw WorkspaceError.validation("Във файла няма разпознаваем текст.");
            }
        } catch (WorkspaceError error) { throw error; }
        catch (Exception error) { throw WorkspaceError.validation("Файлът не може да бъде прочетен. Проверете формата и премахнете защитата с парола."); }
        return new SyllabusMaterial(upload.fileName(), text, Base64.getEncoder().encodeToString(upload.bytes()));
    }

    private DecodedUpload decode(OrgAccess.Scope scope, Upload request, Set<String> allowedFormats) {
        if (!scope.roles().contains("TEACHER") && !scope.roles().contains("ORG_ADMIN")) throw WorkspaceError.forbidden();
        if (request == null || request.fileName() == null || request.fileName().isBlank()
                || request.fileName().length() > 255 || request.fileName().contains("/") || request.fileName().contains("\\")
                || request.fileName().codePoints().anyMatch(Character::isISOControl)) {
            throw WorkspaceError.validation("Невалидно име на учебния материал.");
        }
        String name = request.fileName().strip();
        String format = name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        if (!allowedFormats.contains(format)) throw WorkspaceError.validation(allowedFormats.contains("png")
                ? "Изберете Word (DOCX), PDF или PNG/JPEG снимка." : allowedFormats.equals(Set.of("pdf", "docx"))
                ? "Изберете PDF или DOCX файл." : "Изберете PDF, PPTX, DOCX или TXT файл.");
        if (request.base64() == null || request.base64().isEmpty() || request.base64().length() > MAX_BASE64_LENGTH) {
            throw WorkspaceError.validation("Учебният материал трябва да е до 8 MB.");
        }
        byte[] bytes;
        try { bytes = Base64.getDecoder().decode(request.base64()); }
        catch (IllegalArgumentException error) { throw WorkspaceError.validation("Невалиден файл."); }
        if (bytes.length == 0 || bytes.length > MAX_FILE_BYTES) throw WorkspaceError.validation("Изберете непразен файл до 8 MB.");
        return new DecodedUpload(name, format, bytes);
    }

    private String normalizeText(String text) {
        text = text.replace("\r\n", "\n").replace('\r', '\n').replace('\f', '\n').strip();
        if (text.startsWith("\uFEFF")) text = text.substring(1).strip();
        return text;
    }

    private void validatePdf(byte[] bytes) throws IOException {
        try (var document = Loader.loadPDF(bytes)) {
            if (document.isEncrypted()) throw WorkspaceError.validation("Изберете PDF без защита с парола.");
            if (document.getNumberOfPages() > 200) throw WorkspaceError.validation("PDF материалът трябва да е до 200 страници.");
        }
    }

    private String plainText(byte[] bytes) throws IOException {
        String text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
        if (text.codePoints().anyMatch(c -> Character.isISOControl(c) && c != '\n' && c != '\r' && c != '\t' && c != '\f')) {
            throw WorkspaceError.validation("TXT файлът трябва да съдържа текст в UTF-8.");
        }
        if (text.length() > MAX_TEXT_LENGTH) throw textLimit();
        return text;
    }

    private String pdfText(byte[] bytes) throws IOException {
        try (var document = Loader.loadPDF(bytes)) {
            if (document.isEncrypted()) throw WorkspaceError.validation("Изберете PDF без защита с парола.");
            if (document.getNumberOfPages() > 200) throw WorkspaceError.validation("PDF материалът трябва да е до 200 страници.");
            var output = new TextOutput();
            var stripper = new PDFTextStripper();
            stripper.setSortByPosition(true);
            stripper.writeText(document, output);
            return output.toString();
        }
    }

    private String officeText(byte[] bytes, String format) throws Exception {
        var documents = new HashMap<String, byte[]>();
        var names = new HashSet<String>();
        int expanded = 0, entries = 0;
        try (var zip = new ZipInputStream(new ByteArrayInputStream(bytes))) {
            java.util.zip.ZipEntry entry;
            byte[] buffer = new byte[8192];
            while ((entry = zip.getNextEntry()) != null) {
                if (++entries > 1000 || !names.add(entry.getName())) throw archiveLimit();
                String path = entry.getName();
                boolean keep = format.equals("docx") ? path.equals("word/document.xml")
                        : path.matches("ppt/slides/slide[1-9][0-9]{0,8}\\.xml") || path.equals("ppt/presentation.xml") || path.equals("ppt/_rels/presentation.xml.rels");
                var content = keep ? new ByteArrayOutputStream() : null;
                int read;
                while ((read = zip.read(buffer)) != -1) {
                    expanded += read;
                    if (expanded > MAX_EXPANDED_BYTES) throw archiveLimit();
                    if (keep) {
                        if (content.size() + read > MAX_XML_BYTES) throw archiveLimit();
                        content.write(buffer, 0, read);
                    }
                }
                if (keep) documents.put(path, content.toByteArray());
            }
        }
        var output = new TextOutput();
        if (format.equals("docx")) {
            byte[] document = documents.get("word/document.xml");
            if (document == null) throw WorkspaceError.validation("Невалиден Word документ.");
            extractXml(document, output, "wordprocessingml");
        } else {
            for (String slide : slideOrder(documents)) {
                extractXml(documents.get(slide), output, "drawingml");
                output.append('\n');
            }
        }
        return output.toString();
    }

    private List<String> slideOrder(Map<String, byte[]> documents) throws Exception {
        // Presentation order may differ from the numeric names after a teacher rearranges slides.
        if (documents.containsKey("ppt/presentation.xml") && documents.containsKey("ppt/_rels/presentation.xml.rels")) {
            var targets = new HashMap<String, String>();
            parseXml(documents.get("ppt/_rels/presentation.xml.rels"), new DefaultHandler() {
                @Override public void startElement(String uri, String local, String qName, Attributes attributes) {
                    if (local.equals("Relationship") && !"External".equals(attributes.getValue("TargetMode"))) {
                        String target = attributes.getValue("Target");
                        if (target != null && target.matches("(?:/ppt/)?slides/slide[1-9][0-9]{0,8}\\.xml")) {
                            targets.put(attributes.getValue("Id"), target.startsWith("/") ? target.substring(1) : "ppt/" + target);
                        }
                    }
                }
            });
            var ordered = new ArrayList<String>();
            parseXml(documents.get("ppt/presentation.xml"), new DefaultHandler() {
                @Override public void startElement(String uri, String local, String qName, Attributes attributes) {
                    if (!local.equals("sldId")) return;
                    for (int i = 0; i < attributes.getLength(); i++) if (attributes.getLocalName(i).equals("id")) {
                        String target = targets.get(attributes.getValue(i));
                        if (target != null && documents.containsKey(target) && !ordered.contains(target)) ordered.add(target);
                    }
                }
            });
            if (ordered.isEmpty()) throw WorkspaceError.validation("Презентацията няма четими слайдове.");
            return ordered;
        }
        return documents.keySet().stream().filter(path -> path.startsWith("ppt/slides/slide"))
                .sorted(Comparator.comparingInt(path -> Integer.parseInt(path.substring("ppt/slides/slide".length(), path.length() - 4)))).toList();
    }

    private void extractXml(byte[] bytes, TextOutput output, String vocabulary) throws Exception {
        parseXml(bytes, new DefaultHandler() {
            private boolean text;
            private boolean vocabulary(String uri) { return uri != null && uri.contains("/" + vocabulary + "/"); }
            @Override public void startElement(String uri, String local, String qName, Attributes attributes) {
                if (vocabulary(uri) && local.equals("t")) text = true;
                if (vocabulary(uri) && (local.equals("br") || local.equals("tab"))) output.append(local.equals("tab") ? '\t' : '\n');
            }
            @Override public void characters(char[] chars, int start, int length) { if (text) output.write(chars, start, length); }
            @Override public void endElement(String uri, String local, String qName) {
                if (vocabulary(uri) && local.equals("t")) text = false;
                if (vocabulary(uri) && local.equals("p")) output.append('\n');
            }
        });
    }

    private void parseXml(byte[] bytes, DefaultHandler handler) throws Exception {
        var factory = SAXParserFactory.newInstance();
        factory.setNamespaceAware(true);
        factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        var parser = factory.newSAXParser();
        parser.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        parser.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
        var reader = parser.getXMLReader();
        reader.setContentHandler(handler);
        reader.setErrorHandler(new DefaultHandler() {
            @Override public void error(org.xml.sax.SAXParseException error) throws SAXException { throw error; }
            @Override public void fatalError(org.xml.sax.SAXParseException error) throws SAXException { throw error; }
        });
        reader.parse(new org.xml.sax.InputSource(new ByteArrayInputStream(bytes)));
    }

    private static WorkspaceError textLimit() { return WorkspaceError.validation("Учебният материал трябва да съдържа до 100 000 символа текст. Разделете го на по-малки части."); }
    private static WorkspaceError archiveLimit() { return WorkspaceError.validation("Документът е твърде сложен или голям. Разделете го на по-малки части."); }

    private static class TextOutput extends Writer {
        private final StringBuilder text = new StringBuilder();
        @Override public void write(char[] chars, int offset, int length) {
            if ((long) text.length() + length > MAX_TEXT_LENGTH) throw textLimit();
            text.append(chars, offset, length);
        }
        @Override public TextOutput append(char value) { write(new char[]{value}, 0, 1); return this; }
        @Override public void flush() {}
        @Override public void close() {}
        @Override public String toString() { return text.toString(); }
    }

    public record Upload(@NotBlank @Size(max = 255) String fileName, @NotBlank @Size(max = MAX_BASE64_LENGTH) String base64) {}
    public record Material(String fileName, String sourceText, int characterCount) {}
    public record SyllabusMaterial(String fileName, String sourceText, String fileBase64) {}
    public record TestDocument(String fileName, String sourceText, String mediaType, String fileBase64) {}
    private record DecodedUpload(String fileName, String format, byte[] bytes) {}
}
