import type { ReactNode } from 'react'
import studyImage from '../assets/auth-study.png'
import { ThemeToggle } from './ThemeToggle'
import './AuthLayout.css'

const copyrightYear = new Date().getFullYear()

export function AuthLayout({ children }: { children: ReactNode }) {
  return <main className="auth-page">
    <section className="auth-visual" aria-label="ExamAI">
      <img src={studyImage} alt="" className="auth-image" fetchPriority="high" />
      <div className="auth-visual-content">
        <a className="auth-brand" href="/" aria-label="ExamAI, начало">
          <img src="/examai-mark.svg" width={52} height={52} alt="" />
          <h1>Exam<span>AI</span></h1>
        </a>
        <p className="auth-motto">Знанието започва<br />с въпрос.</p>
      </div>
    </section>
    <section className="auth-content">
      <div className="auth-theme-bar"><ThemeToggle /></div>
      <div className="auth-form-wrap">{children}</div>
      <footer className="auth-footer">&copy; {copyrightYear} ExamAI</footer>
    </section>
  </main>
}
