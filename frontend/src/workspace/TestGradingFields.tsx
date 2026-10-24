import type { Definition } from './types'

type GradingSettings = Pick<Definition, 'gradingScale' | 'passThreshold'>

export function TestGradingFields({ value, onChange }: { value: GradingSettings; onChange: (value: GradingSettings) => void }) {
  return <div className="ws-form-grid">
    <label>Скала<select aria-label="Скала" value={value.gradingScale} onChange={event => onChange({ ...value, gradingScale: event.target.value })}><option value="bulgarian">Българска (2–6)</option><option value="percentage">Процент</option><option value="pass_fail">Успешен / неуспешен</option></select></label>
    <label>Праг за успех (%)<input type="number" min={0} max={100} value={value.passThreshold} onChange={event => onChange({ ...value, passThreshold: Number(event.target.value) })} /></label>
  </div>
}
