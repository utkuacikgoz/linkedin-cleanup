import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Panel } from './Panel.tsx'
import '../../../src/web/styles.css'
import './panel.css'

const root = document.getElementById('root')
if (root) createRoot(root).render(<StrictMode><Panel /></StrictMode>)
