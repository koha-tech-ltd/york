import React from 'react'
import { createRoot } from 'react-dom/client'
import { BubbleApp } from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BubbleApp />
  </React.StrictMode>
)
