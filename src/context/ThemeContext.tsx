'use client'

import { createContext, useContext, useEffect } from 'react'
import type { ReactNode } from 'react'

type Theme = {
  backgroundColor: string
  backgroundImage?: string
}

const DEFAULT_THEME: Theme = {
  backgroundColor: '#f5f7fa',
}

type ThemeContextValue = {
  theme: Theme
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = DEFAULT_THEME

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--app-background-color', theme.backgroundColor)
    root.style.setProperty('--app-background-image', theme.backgroundImage ?? 'none')
  }, [theme.backgroundColor, theme.backgroundImage])

  return <ThemeContext.Provider value={{ theme }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
