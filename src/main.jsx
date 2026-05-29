import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useRegisterSW } from 'virtual:pwa-register/react'
import './index.css'
import App from './App.jsx'

function Root() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      // Poll every 60 s in background so the SW checks for updates
      // without requiring a page reload
      if (r) {
        setInterval(() => r.update(), 60_000);
      }
    },
    onRegisterError(error) {
      console.warn('SW registration error:', error);
    },
  });

  return (
    <App
      pwaUpdateAvailable={needRefresh}
      onPwaUpdate={() => updateServiceWorker(true)}
    />
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)

