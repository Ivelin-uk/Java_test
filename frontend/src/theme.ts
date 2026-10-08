export type Theme = 'light' | 'dark'
const key = 'quicktest.theme'

function preference(): Theme | null {
  try { const value = localStorage.getItem(key); return value === 'dark' || value === 'light' ? value : null } catch { return null }
}
function apply(theme: Theme) { document.documentElement.dataset.theme = theme }
export function initializeTheme() { apply(preference() ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) }
export function currentTheme(): Theme { return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light' }
export function changeTheme(theme: Theme) {
  apply(theme)
  try { localStorage.setItem(key, theme) } catch { /* Keep the current selection when storage is unavailable. */ }
  window.dispatchEvent(new Event('quicktest:theme'))
}
export function subscribeTheme(changed: () => void) {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const system = () => { if (!preference()) { initializeTheme(); changed() } }
  const storage = (event: StorageEvent) => { if (event.key === key || event.key === null) { initializeTheme(); changed() } }
  window.addEventListener('quicktest:theme', changed)
  window.addEventListener('storage', storage)
  media.addEventListener('change', system)
  return () => { window.removeEventListener('quicktest:theme', changed); window.removeEventListener('storage', storage); media.removeEventListener('change', system) }
}
