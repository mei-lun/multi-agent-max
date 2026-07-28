import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { TooltipProvider } from './components/ui/tooltip'
import { UiLocaleProvider } from './i18n/ui-locale'
import './assets/main.css'

const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')

function applyColorScheme(): void {
  document.documentElement.classList.toggle('dark', colorScheme.matches)
}

applyColorScheme()
colorScheme.addEventListener('change', applyColorScheme)

const root = document.getElementById('root')
if (!root) throw new Error('Renderer root element is missing')

createRoot(root).render(
  <StrictMode>
    <UiLocaleProvider>
      <TooltipProvider delayDuration={400}>
        <App />
      </TooltipProvider>
    </UiLocaleProvider>
  </StrictMode>
)
