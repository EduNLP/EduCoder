'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

type ThemeOption = {
  id: string
  label: string
  description: string
  backgroundColor: string
  backgroundImage?: string
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'gradient',
    label: 'Aurora Gradient',
    description: 'Original textured background',
    backgroundColor: '#f8fafc',
    backgroundImage:
      'radial-gradient(circle at 20% 20%, rgba(125, 211, 252, 0.35), transparent 45%), radial-gradient(circle at 80% 0%, rgba(199, 210, 254, 0.35), transparent 40%), linear-gradient(135deg, rgba(248, 250, 252, 1), rgba(241, 245, 249, 1))',
  },
  {
    id: 'f5f7fa',
    label: 'Soft Slate',
    description: 'Soft slate wash',
    backgroundColor: '#f5f7fa',
  },
  {
    id: 'f4f2fa',
    label: 'Lavender Mist',
    description: 'Lavender mist',
    backgroundColor: '#f4f2fa',
  },
  {
    id: 'e7f0fb',
    label: 'Sky Notebook',
    description: 'Sky notebook',
    backgroundColor: '#e7f0fb',
  },
]

type ThemeContextValue = {
  themeId: string
  theme: ThemeOption
  setTheme: (themeId: string) => void
  themeOptions: ThemeOption[]
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

const DEFAULT_THEME_ID = THEME_OPTIONS[0].id
const STORAGE_KEY = 'transcript-annotation-theme'

const getInitialThemeId = () => {
  if (typeof window === 'undefined') {
    return DEFAULT_THEME_ID
  }
  const storedId = window.localStorage.getItem(STORAGE_KEY)
  const isValid = THEME_OPTIONS.some((option) => option.id === storedId)
  return isValid && storedId ? storedId : DEFAULT_THEME_ID
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState<string>(getInitialThemeId)

  const theme = useMemo(() => {
    return THEME_OPTIONS.find((option) => option.id === themeId) ?? THEME_OPTIONS[0]
  }, [themeId])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(STORAGE_KEY, theme.id)
  }, [theme.id])

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--app-background-color', theme.backgroundColor)
    root.style.setProperty('--app-background-image', theme.backgroundImage ?? 'none')
  }, [theme])

  const handleSetTheme = (nextId: string) => {
    const isValid = THEME_OPTIONS.some((option) => option.id === nextId)
    setThemeId(isValid ? nextId : DEFAULT_THEME_ID)
  }

  return (
    <ThemeContext.Provider
      value={{
        themeId,
        theme,
        setTheme: handleSetTheme,
        themeOptions: THEME_OPTIONS,
      }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}

