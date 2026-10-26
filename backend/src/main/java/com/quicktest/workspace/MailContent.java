package com.quicktest.workspace;

import org.springframework.web.util.HtmlUtils;
import java.util.Map;
import static com.quicktest.workspace.WorkspaceValues.*;

/** The same message is used by SMTP and HTTPS providers. No answer snapshots go into email. */
public record MailContent(String subject,String text,String html) {
    public static MailContent render(Map<String,Object> payload,String frontend) {
        String type=string(payload,"notificationType"),subject,body;
        String origin=frontend.replaceAll("/+$","");
        if(type.equals("final_result")) {
            subject="ExamAI: "+(Boolean.TRUE.equals(payload.get("corrected"))?"Коригиран резултат: ":"Резултат: ")+string(payload,"test");
            body="Организация: "+string(payload,"organization")+"\nТест: "+string(payload,"test")+"\nОбучаем: "+string(payload,"student")+"\nОпит: "+string(payload,"attemptNumber")
                    +"\nТочки: "+string(payload,"points")+" / "+string(payload,"maximumPoints")+"\nПроцент: "+string(payload,"percentage")+"%"
                    +"\nОценка: "+string(payload,"grade")+"\nРезултат: "+(string(payload,"outcome").equals("passed")?"Успешен":"Неуспешен")
                    +"\nДата: "+string(payload,"publishedAt")+"\n\nПреглед на теста и резултата: "+origin+string(payload,"protectedPath")
                    +"\nВлезте с ученическия си профил. Подробните отговори са достъпни според срока за преглед, зададен от учителя.";
        } else if(type.equals("invitation")) {
            subject="ExamAI: Покана за "+string(payload,"organization");body="Покана: "+origin+"/#invitation="+string(payload,"token")+"\nВалидна до: "+string(payload,"expires_at");
        } else if(type.equals("assignment_code")) {
            subject="ExamAI: Код за тест";body="Организация: "+string(payload,"organization")+"\nТест: "+string(payload,"test")+"\nКод: "+string(payload,"code")+"\nВход: "+origin;
        } else if(type.equals("assignment_assigned")) {
            subject="ExamAI: Нов възложен тест — "+string(payload,"test");
            body="Организация: "+string(payload,"organization")+"\nВъзложен ти е тест: "+string(payload,"test")+"\n\nОтвори теста: "+origin+string(payload,"assignmentPath")+"\nВлез с ученическия си профил, за да го прегледаш и започнеш.";
        } else {
            subject="ExamAI: "+(type.equals("notification_email")?"Потвърждение на имейл":"Възстановяване на парола");
            body="Линк: "+origin+(type.equals("notification_email")?"/verify-email?token=":"/reset-password?token=")+string(payload,"token")+"\nВалиден до: "+string(payload,"expires_at");
        }
        String html="<div lang=\"bg\" style=\"font-family:Arial,sans-serif;line-height:1.6;color:#172c35\"><h2>"+HtmlUtils.htmlEscape(subject)+"</h2><p>"+HtmlUtils.htmlEscape(body).replace("\n","<br>")+"</p>";
        if(type.equals("final_result") && string(payload,"protectedPath").matches("/results/[1-9][0-9]{0,17}")) {
            html+="<p><a href=\""+HtmlUtils.htmlEscape(origin+string(payload,"protectedPath"))+"\" style=\"display:inline-block;padding:12px 20px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:6px\">Преглед на теста и резултата</a></p>";
        }
        if(type.equals("assignment_assigned") && string(payload,"assignmentPath").matches("/learner/assignments/[1-9][0-9]{0,17}")) {
            html+="<p><a href=\""+HtmlUtils.htmlEscape(origin+string(payload,"assignmentPath"))+"\" style=\"display:inline-block;padding:12px 20px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:6px\">Отвори възложения тест</a></p>";
        }
        return new MailContent(subject.replaceAll("[\\r\\n]"," "),body,html+"</div>");
    }
}
