import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { TooltipProvider } from './components/ui/tooltip'
import { UiLocaleProvider } from './i18n/ui-locale'
import './assets/main.css'

window.addEventListener('error', (event) => {
  console.error('renderer_error', event.error?.stack ?? event.message)
})
window.addEventListener('unhandledrejection', (event) => {
  console.error('renderer_unhandled_rejection', event.reason?.stack ?? String(event.reason))
})

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
