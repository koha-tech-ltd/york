import React from 'react'
import { createRoot } from 'react-dom/client'
import { CompositorApp } from './App'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CompositorApp />
  </React.StrictMode>
)
