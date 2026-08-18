import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// CSS imports: order matters!
// 1. RawBlock design tokens & global styles
import './styles/tokens.css'
// 2. KaTeX base styles
import 'katex/dist/katex.min.css'
// 3. KaTeX monospace override (must come AFTER KaTeX base)
import './styles/katex-override.css'
// 4. Global root resets
import './index.css'

import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
