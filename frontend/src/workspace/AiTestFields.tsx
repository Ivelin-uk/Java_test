import { difficulties, questionTypes, requestedImages, validDistribution } from './aiSettings'
import type { AiSettings } from './aiSettings'

export function AiTestFields({ value, onChange, disabled, maximum = 20 }: { value: AiSettings; onChange: (next: AiSettings) => void; disabled: boolean; maximum?: number }) {
  function patch(next: Partial<AiSettings>) { onChange({ ...value, ...next }) }
  return <fieldset className="ws-editor" disabled={disabled}>
    <div className="ws-form-grid">
      <label>Тема<input autoFocus required value={value.topic} maxLength={190} onChange={e => patch({ topic: e.target.value })} /></label>
      <label>Дисциплина<input value={value.subject} maxLength={190} onChange={e => patch({ subject: e.target.value })} /></label>
      <label>Въпроси<input type="number" min={1} max={maximum} step={1} value={value.questionCount} onChange={e => patch({ questionCount: Number(e.target.value) })} /></label>
      <label>Трудност<select aria-label="Трудност" value={value.difficulty} onChange={e => patch({ difficulty: e.target.value })}>{Object.entries(difficulties).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
    </div>
    <fieldset className="ws-ai-types"><legend>Типове въпроси</legend><div className="ws-actions">{questionTypes.map(([key, title]) => <label className="ws-check" key={key}><input type="checkbox" checked={value.questionTypes.includes(key)} onChange={e => patch({ questionTypes: e.target.checked ? [...value.questionTypes, key] : value.questionTypes.filter(t => t !== key) })} />{title}</label>)}</div></fieldset>
    <div className="ws-ai-image-settings"><label className="ws-check"><input type="checkbox" checked={value.includeImages} onChange={e => patch({ includeImages: e.target.checked })} />С изображения</label>{value.includeImages && <label>Въпроси с изображение<input type="number" min={1} max={value.questionCount} step={1} value={requestedImages(value)} onChange={e => patch({ imageCount: Number(e.target.value) })} /></label>}</div>
    {value.difficulty === 'MIXED' && <div className="ws-form-grid">{Object.entries(difficulties).filter(([key]) => key !== 'MIXED').map(([key, title]) => <label key={key}>{title}<input type="number" min={0} max={20} step={1} value={value.difficultyCounts[key]} onChange={e => patch({ difficultyCounts: { ...value.difficultyCounts, [key]: Number(e.target.value) } })} /></label>)}</div>}
    {!validDistribution(value) && <p className="error" role="alert">Сумата по трудност трябва да е равна на броя въпроси.</p>}
    <label>Допълнителна информация за теста<textarea aria-label="Допълнителна информация за теста" rows={5} value={value.additionalInformation} maxLength={20000} onChange={e => patch({ additionalInformation: e.target.value })} /></label>
  </fieldset>
}
