package com.quicktest.workspace;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Clock;
import java.util.*;
import java.io.*;
import javax.imageio.ImageIO;
import static com.quicktest.workspace.WorkspaceStore.*;

@Service
public class PrivateImageService {
    private final WorkspaceStore db;private final OrganizationService organizations;private final WorkspaceAudit audit;private final Clock clock;private final WorkspaceCrypto crypto;
    public PrivateImageService(WorkspaceStore db,OrganizationService organizations,WorkspaceAudit audit,Clock clock,WorkspaceCrypto crypto) {this.db=db;this.organizations=organizations;this.audit=audit;this.clock=clock;this.crypto=crypto;}
    @Transactional public Object upload(OrgAccess.Scope scope,Upload request) {
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
        long used=db.count("SELECT COALESCE(SUM(byte_size),0) FROM private_images WHERE organization_id=?",scope.organizationId());
        if(used+canonical.length>number(limits,"storage_bytes")) throw WorkspaceError.conflict("Изчерпан лимит за хранилище.");
        long id=db.insert("INSERT INTO private_images(organization_id,owner_id,purpose,mime_type,byte_size,width,height,content,created_at) VALUES(?,?,?,?,?,?,?,?,?)",scope.organizationId(),scope.userId(),request.purpose(),"image/"+format,canonical.length,width,height,canonical,clock.instant());
        if(request.purpose().equals("logo")) db.update("UPDATE organizations SET logo_id=? WHERE id=?",id,scope.organizationId());
        audit.write(scope.organizationId(),scope.userId(),"image.uploaded",id,Map.of("purpose",request.purpose(),"bytes",canonical.length));return Map.of("id",id,"width",width,"height",height);
    }
    public void validateQuestionImage(OrgAccess.Scope scope,Long id) {
        if(id==null) return;var file=db.one("SELECT id,owner_id,purpose FROM private_images WHERE (organization_id=? OR ?) AND id=?",scope.organizationId(),scope.platform(),id);
        if(!string(file,"purpose").equals("question") || !teacherCanRead(scope,file)) throw WorkspaceError.forbidden();
    }
    private boolean teacherCanRead(OrgAccess.Scope scope,Map<String,Object> file) {
        if(scope.roles().contains("ORG_ADMIN") || number(file,"owner_id")==scope.userId()) return true;
        long id=number(file,"id");
        for(var row:db.rows("SELECT definition_json FROM workspace_assessments WHERE (organization_id=? OR ?) AND shared=TRUE",scope.organizationId(),scope.platform())) if(db.parse(row.get("definition_json"),AssessmentService.Definition.class).questions().stream().anyMatch(q->Objects.equals(q.imageId(),id))) return true;
        for(var row:db.rows("SELECT definition_json FROM question_bank_items WHERE (organization_id=? OR ?) AND shared=TRUE",scope.organizationId(),scope.platform())) if(Objects.equals(db.parse(row.get("definition_json"),AssessmentService.Question.class).imageId(),id)) return true;
        return false;
    }
    public Image download(OrgAccess.Scope scope,long id,Long attempt,AttemptService.Session session) {
        var file=db.one("SELECT id,owner_id,purpose,mime_type FROM private_images WHERE organization_id=? AND id=?",scope.organizationId(),id);
        boolean allowed=string(file,"purpose").equals("logo");
        if(!allowed && (scope.roles().contains("TEACHER") || scope.roles().contains("ORG_ADMIN"))) allowed=teacherCanRead(scope,file);
        if(!allowed && scope.roles().contains("STUDENT") && attempt!=null) {
            var row=db.one("SELECT a.*,x.ends_at,x.answers_after_deadline FROM exam_attempts a JOIN exam_assignments x ON x.organization_id=a.organization_id AND x.id=a.assignment_id WHERE (a.organization_id=? OR ?) AND a.id=? AND a.student_id=?",scope.organizationId(),scope.platform(),attempt,scope.userId());
            boolean active=string(row,"status").equals("in_progress") && session.token()!=null && session.authorization()!=null && session.browserId()!=null;
            if(active) active=crypto.matches(session.token(),string(row,"session_hash")) && crypto.matches(session.authorization(),string(row,"auth_session_hash")) && session.browserId().equals(string(row,"browser_id"));
            boolean released=string(row,"status").equals("finalized") && (!flag(row,"answers_after_deadline") || !clock.instant().isBefore(time(row,"ends_at")));
            if(active || released) for(var q:db.rows("SELECT definition_json,status,position_index,deadline_at FROM attempt_questions WHERE organization_id=? AND attempt_id=?",number(row,"organization_id"),attempt)) {
                if(active && (!string(q,"status").equals("open") || number(q,"position_index")!=number(row,"current_position") || !clock.instant().isBefore(time(q,"deadline_at")))) continue;
                var question=db.parse(db.json(db.object(q.get("definition_json")).get("question")),AssessmentService.Question.class);if(Objects.equals(question.imageId(),id)) allowed=true;
            }
        }
        if(!allowed) throw WorkspaceError.forbidden();
        byte[] content=db.jdbc.queryForObject("SELECT content FROM private_images WHERE organization_id=? AND id=?",byte[].class,scope.organizationId(),id);return new Image(string(file,"mime_type"),content);
    }
    public record Upload(String purpose,String base64) {}
    public record Image(String mime,byte[] content) {}
}
