export function DurationInput({ seconds, question, onChange }: { seconds: number; question: number; onChange: (seconds: number) => void }) {
  const minutes = Math.floor(seconds / 60), remainder = seconds % 60
  return <fieldset className="ws-duration-input">
    <legend>Време</legend>
    <label>Минути<input type="number" min={0} max={60} step={1} aria-label={`Минути за въпрос ${question}`} value={minutes} onChange={event => onChange(Number(event.target.value) * 60 + remainder)} /></label>
    <label>Секунди<input type="number" min={minutes === 0 ? 10 : 0} max={minutes === 60 ? 0 : 59} step={1} aria-label={`Секунди за въпрос ${question}`} value={remainder} onChange={event => onChange(minutes * 60 + Number(event.target.value))} /></label>
  </fieldset>
}
