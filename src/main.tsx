import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource-variable/space-grotesk'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'
import { MascotToastProvider } from './contexts/MascotToastContext'
import { AdminReviewProvider } from './contexts/AdminReviewContext'
import { ViewerLocationProvider } from './contexts/ViewerLocationContext'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter future={{ v7_relativeSplatPath: true }}>
      <AuthProvider>
        <ViewerLocationProvider>
          <AdminReviewProvider>
            <MascotToastProvider>
              <App />
            </MascotToastProvider>
          </AdminReviewProvider>
        </ViewerLocationProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
