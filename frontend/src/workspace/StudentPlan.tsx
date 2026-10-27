import { BookOpen, Check } from 'lucide-react'

export function StudentPlan() {
  return <section className="ws-profile-form ws-profile-student-plan" aria-label="Твоят план">
    <h3><BookOpen size={20} aria-hidden="true" /> Безплатен ученически достъп</h3>
    <p className="ws-muted">Участието ти в ExamAI е безплатно.</p>
    <ul>{['Присъединяване към групи с код от учител', 'Решаване на възложени тестове', 'Преглед на резултати и обратна връзка след проверка'].map(feature => <li key={feature}><Check size={18} aria-hidden="true" />{feature}</li>)}</ul>
    <p className="ws-muted">Платеният план Pro е за учители и добавя повече групи, възлагания и AI възможности.</p>
  </section>
}
