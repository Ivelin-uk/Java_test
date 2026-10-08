import { useSyncExternalStore } from 'react'
import { Moon, Sun } from 'lucide-react'
import { changeTheme, currentTheme, subscribeTheme } from '../theme'

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, currentTheme)
  const title = theme === 'dark' ? 'Светла тема' : 'Тъмна тема'
  return <button type="button" className="icon-button theme-toggle" title={title} aria-label={title} onClick={() => changeTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
}
