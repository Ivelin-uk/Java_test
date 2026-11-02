const grades = Array.from({ length: 12 }, (_, index) => String(index + 1))

export function GradeField({ value, onChange, disabled = false }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  return <label>Клас<select aria-label="Клас" value={value} disabled={disabled} onChange={event => onChange(event.target.value)}><option value="">Без зададен клас</option>{grades.map(grade => <option key={grade} value={grade}>{grade}. клас</option>)}{value && !grades.includes(value) && <option value={value}>{value}</option>}</select></label>
}
