import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { useAuthStore } from './stores/authStore'
import './index.css'

// Inicjalizacja QueryClienta dla TanStack Query - zarządzanie cachem danych z API
const queryClient = new QueryClient()

// Komponent Root służy do opakowania aplikacji w potrzebny context i inicjalizację sesji
function Root() {
  const initializeAuth = useAuthStore(s => s.initializeAuth)

  // Odpalamy mechanizm autoryzacji przy starcie aplikacji (mount komponentu Root)
  useEffect(() => {
    const unsubscribe = initializeAuth()
    return unsubscribe // Cleanup przy unmountowaniu (odpięcie listenera Supabase)
  }, [initializeAuth])

  return (
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  )
}

// Główny punkt wejścia renderujemy Roota w kontenerze DOM (index.html)
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
