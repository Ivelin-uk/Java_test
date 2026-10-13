package com.quicktest.workspace;

import com.quicktest.workspace.repository.PrivateImageRepository;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Clock;
import java.util.*;
import java.io.*;
import javax.imageio.ImageIO;
import static com.quicktest.workspace.WorkspaceValues.*;

@Service
public class PrivateImageService {
    private final WorkspaceJson json;
    private final PrivateImageRepository repository;private final OrganizationService organizations;private final WorkspaceAudit audit;private final Clock clock;private final WorkspaceCrypto crypto;
    public PrivateImageService(PrivateImageRepository repository,WorkspaceJson json,OrganizationService organizations,WorkspaceAudit audit,Clock clock,WorkspaceCrypto crypto) {this.repository=repository;this.json=json;this.organizations=organizations;this.audit=audit;this.clock=clock;this.crypto=crypto;}
    @Transactional public Object upload(OrgAccess.Scope scope,Upload request) {
        if(!scope.roles().contains("TEACHER") && !scope.roles().contains("ORG_ADMIN")) throw WorkspaceError.forbidden();
        if(!Set.of("question","logo").contains(Objects.toString(request.purpose(),"")) || request.base64()==null || request.base64().length()>2800000 || request.purpose().equals("logo") && !scope.roles().contains("ORG_ADMIN")) throw WorkspaceError.validation("Невалидно изображение.");
        byte[] original;try {original=Base64.getDecoder().decode(request.base64());}catch(IllegalArgumentException e) {throw WorkspaceError.validation("Невалидно изображение.");}
        if(original.length==0 || original.length>2*1024*1024) throw WorkspaceError.validation("Изображението трябва да е до 2 MB.");
        byte[] canonical;String format;int width,height;
        try(var input=ImageIO.createImageInputStream(new ByteArrayInputStream(original))) {
            var readers=ImageIO.getImageReaders(input);if(!readers.hasNext()) throw WorkspaceError.validation("Поддържат се PNG и JPEG.");var reader=readers.next();
            try {reader.setInput(input);format=reader.getFormatName().toLowerCase(Locale.ROOT);width=reader.getWidth(0);height=reader.getHeight(0);
                if(!Set.of("png","jpeg").contains(format) || width<1 || height<1 || width>2048 || height>2048 || (long)width*height>4000000) throw WorkspaceError.validation("PNG/JPEG до 2048 px и 4 MP.");
                var output=new ByteArrayOutputStream();ImageIO.write(reader.read(0),format,output);canonical=output.toByteArray();if(canonical.length>2*1024*1024) throw WorkspaceError.validation("Изображението е твърде голямо.");
            } finally {reader.dispose();}
        } catch(IOException e) {throw WorkspaceError.validation("Повредено изображение.");}
        organizations.lockQuota(scope.organizationId());var limits=organizations.subscription(scope.organizationId());
        long used=repository.storageUsed(scope.organizationId());
        if(used+canonical.length>number(limits,"storage_bytes")) throw WorkspaceError.conflict("Изчерпан лимит за хранилище.");
        long id=repository.insertImage(scope.organizationId(), scope.userId(), request.purpose(), "image/"+format, canonical.length, width, height, canonical, clock.instant());
        if(request.purpose().equals("logo")) repository.setOrganizationLogo(id, scope.organizationId());
        audit.write(scope.organizationId(),scope.userId(),"image.uploaded",id,Map.of("purpose",request.purpose(),"bytes",canonical.length));return Map.of("id",id,"width",width,"height",height);
    }
    public void validateQuestionImage(OrgAccess.Scope scope,Long id) {
        if(id==null) return;var file=repository.requireImageMetadata(scope.organizationId(), scope.platform(), id);
        if(!string(file,"purpose").equals("question") || !teacherCanRead(scope,file)) throw WorkspaceError.forbidden();
    }
    private boolean teacherCanRead(OrgAccess.Scope scope,Map<String,Object> file) {
        if(scope.roles().contains("ORG_ADMIN") || number(file,"owner_id")==scope.userId()) return true;
        long id=number(file,"id");
        for(var row:repository.findSharedTestDefinitions(scope.organizationId(), scope.platform())) if(json.parse(row.get("definition_json"),AssessmentService.Definition.class).questions().stream().anyMatch(q->Objects.equals(q.imageId(),id))) return true;
        for(var row:repository.findSharedBankDefinitions(scope.organizationId(), scope.platform())) if(Objects.equals(json.parse(row.get("definition_json"),AssessmentService.Question.class).imageId(),id)) return true;
        return false;
    }
    public Image download(OrgAccess.Scope scope,long id,Long attempt,AttemptService.Session session) {
        var file=repository.requireDownloadMetadata(scope.organizationId(), id);
        boolean allowed=string(file,"purpose").equals("logo");
        if(!allowed && (scope.roles().contains("TEACHER") || scope.roles().contains("ORG_ADMIN"))) allowed=teacherCanRead(scope,file);
        if(!allowed && scope.roles().contains("STUDENT") && attempt!=null) {
            var row=repository.requireAttemptAccess(scope.organizationId(), scope.platform(), attempt, scope.userId());
            boolean active=string(row,"status").equals("in_progress") && session.token()!=null && session.authorization()!=null && session.browserId()!=null;
            if(active) active=crypto.matches(session.token(),string(row,"session_hash")) && crypto.matches(session.authorization(),string(row,"auth_session_hash")) && session.browserId().equals(string(row,"browser_id"));
            boolean released=string(row,"status").equals("finalized") && (!flag(row,"answers_after_deadline") || !clock.instant().isBefore(time(row,"ends_at")));
            if(active || released) for(var q:repository.findAttemptQuestions(number(row,"organization_id"), attempt)) {
                if(active && (!string(q,"status").equals("open") || number(q,"position_index")!=number(row,"current_position") || !clock.instant().isBefore(time(q,"deadline_at")))) continue;
                var question=json.parse(json.write(json.object(q.get("definition_json")).get("question")),AssessmentService.Question.class);if(Objects.equals(question.imageId(),id)) allowed=true;
            }
        }
        if(!allowed) throw WorkspaceError.forbidden();
        byte[] content=repository.requireContent(scope.organizationId(),id);return new Image(string(file,"mime_type"),content);
    }
    public record Upload(String purpose,String base64) {}
    public record Image(String mime,byte[] content) {}
}
