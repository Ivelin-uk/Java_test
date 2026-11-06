import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './theme.css'
import { initializeTheme } from './theme'
import App from './App.tsx'
import './designSystem.css'
import './workspace/workspacePolish.css'

initializeTheme()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
