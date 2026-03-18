import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { useAuthStore } from './stores/authStore'
import './index.css'

const queryClient = new QueryClient()

function Root() {
  const initializeAuth = useAuthStore(s => s.initializeAuth)

  useEffect(() => {
    const unsubscribe = initializeAuth()
    return unsubscribe
  }, [initializeAuth])

  return (
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
