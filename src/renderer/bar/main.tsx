import React from 'react'
import { createRoot } from 'react-dom/client'
import { BarApp } from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BarApp />
  </React.StrictMode>
)
