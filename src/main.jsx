import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './fonts.css'
import './index.css'
import App from './App.jsx'
import { useLang } from './lib/i18n.js'

// A new language redraws everything, so texts worked out once (in lib/) follow.
function Root() {
  const lang = useLang()
  return <App key={lang} />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Root />
    </BrowserRouter>
  </StrictMode>,
)
