import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../shared-ui/styles.css'
import { initTheme } from '../shared-ui/theme'
import { App } from './App'

initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
