'use client'

import {
  ArrowLeft,
  BookmarkCheck,
  ChevronDown,
  ChevronUp,
  LogOut,
  Menu,
  Sparkles,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from '@/context/ThemeContext'
import { useClerk } from '@clerk/nextjs'

type WorkspaceHeaderProps = {
  toolbarVisible: boolean
  onToggleToolbar: () => void
  onWorkspaceClick?: () => void
  title?: string
  workspaceLabel?: string
  showWorkspaceButton?: boolean
  showToolbarToggleButton?: boolean
  menuLinks?: MenuLink[]
  leftLabel?: string
  children?: ReactNode
  onMenuLinkClick?: (link: MenuLink) => void
  menuContent?: ReactNode
  variant?: 'default' | 'minimal'
  density?: 'default' | 'compact'
  workspaceButtonVariant?: 'pill' | 'icon'
}

type MenuLink = {
  id: string
  label: string
  accent?: boolean
  icon?: LucideIcon
}

const defaultMenuLinks: MenuLink[] = [
  { id: 'hunt', label: 'Start Scavenger Hunt ✨', accent: true },
  { id: 'complete', label: 'Mark as Complete', icon: BookmarkCheck },
  { id: 'logout', label: 'Log Out', icon: LogOut },
]

export function WorkspaceHeader({
  toolbarVisible,
  onToggleToolbar,
  onWorkspaceClick,
  title = 'EduCoder',
  workspaceLabel = 'Workspace',
  showWorkspaceButton = true,
  showToolbarToggleButton = true,
  menuLinks = defaultMenuLinks,
  leftLabel,
  children,
  onMenuLinkClick,
  menuContent,
  variant = 'default',
  density = 'default',
  workspaceButtonVariant = 'pill',
}: WorkspaceHeaderProps) {
  const router = useRouter()
  const { signOut } = useClerk()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null)
  const menuPanelRef = useRef<HTMLDivElement | null>(null)
  const { themeId, setTheme, themeOptions } = useTheme()
  const isMinimal = variant === 'minimal'
  const isCompact = density === 'compact'
  const isIconWorkspaceButton = workspaceButtonVariant === 'icon'

  const headerClassName = isMinimal
    ? isCompact
      ? 'relative z-50 flex-shrink-0 px-2 pb-1 pt-3 sm:px-3'
      : 'relative z-50 flex-shrink-0 px-2 pb-1 pt-2 sm:px-3'
    : 'relative z-50 flex-shrink-0 rounded-3xl border border-slate-200/80 bg-white/90 p-4 shadow-xl shadow-slate-200/60 backdrop-blur-xl'

  const layoutClassName = isMinimal
    ? isCompact
      ? 'flex flex-wrap items-center justify-between gap-1.5 md:gap-2'
      : 'flex flex-wrap items-center justify-between gap-2 md:gap-3'
    : 'flex flex-col gap-4 md:flex-row md:items-center'

  const workspacePillButtonClassName = isMinimal
    ? isCompact
      ? 'group inline-flex items-center gap-1.5 rounded-2xl border border-slate-200/80 bg-transparent px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-600 shadow-none transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200'
      : 'group inline-flex items-center gap-2 rounded-2xl border border-slate-200/80 bg-transparent px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-600 shadow-none transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200'
    : 'group inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200'

  const workspaceIconButtonClassName = isMinimal
    ? isCompact
      ? 'group inline-flex h-8 w-8 items-center justify-center rounded-xl p-1.5 text-slate-600 transition hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200'
      : 'group inline-flex h-9 w-9 items-center justify-center rounded-2xl p-2 text-slate-600 transition hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200'
    : 'group inline-flex h-11 w-11 items-center justify-center rounded-2xl p-2 text-slate-600 transition hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200'

  const workspaceButtonClassName = isIconWorkspaceButton
    ? workspaceIconButtonClassName
    : workspacePillButtonClassName

  const leftLabelClassName = isMinimal
    ? isCompact
      ? 'inline-flex min-w-[160px] items-center justify-center rounded-2xl border border-slate-200/80 bg-transparent px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 shadow-none'
      : 'inline-flex min-w-[180px] items-center justify-center rounded-2xl border border-slate-200/80 bg-transparent px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 shadow-none'
    : 'inline-flex min-w-[180px] items-center justify-center rounded-2xl border border-slate-200 bg-white/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 shadow-sm'

  const titleClassName = isMinimal
    ? 'text-[22px] font-semibold leading-tight tracking-tight text-slate-700 py-1'
    : 'text-3xl font-bold tracking-tight text-slate-600 sm:text-4xl'

  const toolbarToggleClassName = isMinimal
    ? isCompact
      ? 'flex items-center gap-2 rounded-2xl border border-slate-200/80 bg-transparent px-2.5 py-0.5 text-xs font-semibold text-slate-600 shadow-none transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 sm:text-sm'
      : 'flex items-center gap-2 rounded-2xl border border-slate-200/80 bg-transparent px-3 py-1.5 text-sm font-semibold text-slate-600 shadow-none transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200'
    : 'flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200'

  const menuButtonClassName = isMinimal
    ? isCompact
      ? 'flex h-8 w-8 items-center justify-center rounded-2xl border border-slate-200/80 bg-transparent text-slate-600 shadow-none transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300'
      : 'flex h-9 w-9 items-center justify-center rounded-2xl border border-slate-200/80 bg-transparent text-slate-600 shadow-none transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300'
    : 'flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300'

  const childrenWrapperClassName = isMinimal
    ? isCompact
      ? 'mt-1.5 border-t border-slate-200/70 pt-1.5'
      : 'mt-3 border-t border-slate-200/70 pt-3'
    : 'mt-4 border-t border-slate-100 pt-4'

  const handleMenuLinkClick = async (link: MenuLink) => {
    if (link.id === 'logout') {
      setMenuOpen(false)
      try {
        await signOut({ redirectUrl: '/' })
      } catch (error) {
        console.error('Sign out failed, redirecting to login anyway.', error)
        router.push('/')
      }
      return
    }

    onMenuLinkClick?.(link)
    setMenuOpen(false)
  }

  useEffect(() => {
    if (!menuOpen) return

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (
        menuPanelRef.current?.contains(target) ||
        menuTriggerRef.current?.contains(target)
      ) {
        return
      }
      setMenuOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

  return (
    <header className={headerClassName}>
      <div className={layoutClassName}>
        <div className={isMinimal ? 'flex items-center gap-2 md:flex-1' : 'flex items-center gap-3 md:flex-1'}>
          {showWorkspaceButton ? (
            <button
              type="button"
              onClick={() => onWorkspaceClick?.()}
              className={workspaceButtonClassName}
              aria-label="Back to workspace"
            >
              <ArrowLeft className="h-4 w-4 transition group-hover:-translate-x-0.5" />
              {!isIconWorkspaceButton && (
                <span>{workspaceLabel}</span>
              )}
            </button>
          ) : (
            leftLabel && (
              <span className={leftLabelClassName}>
                {leftLabel}
              </span>
            )
          )}
        </div>
        <div
          className={
            isMinimal
              ? 'flex flex-1 flex-col items-center text-center'
              : 'flex flex-col items-center text-center md:flex-1'
          }
        >
          <h1 className={titleClassName}>
            {title}
          </h1>
        </div>
        <div
          className={
            isMinimal
              ? 'relative flex items-center justify-end gap-2 sm:gap-3 md:flex-1'
              : 'relative flex items-center justify-end gap-3 md:flex-1'
          }
        >
          {showToolbarToggleButton && (
            <button
              type="button"
              onClick={onToggleToolbar}
              aria-pressed={toolbarVisible}
              aria-label={
                toolbarVisible
                  ? 'Hide search and filters toolbar'
                  : 'Show search and filters toolbar'
              }
              className={toolbarToggleClassName}
            >
              {toolbarVisible ? (
                <>
                  <ChevronUp className="h-4 w-4" />
                  Hide toolbar
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4" />
                  Show toolbar
                </>
              )}
            </button>
          )}
          <button
            type="button"
            ref={menuTriggerRef}
            onClick={() => setMenuOpen((previous) => !previous)}
            className={menuButtonClassName}
            aria-label="Open command menu"
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            aria-controls="command-menu-panel"
          >
            <Menu className="h-5 w-5" />
          </button>
          {menuOpen && (
            <div
              ref={menuPanelRef}
              id="command-menu-panel"
              className="stealth-scrollbar stealth-scrollbar--active absolute right-0 top-[calc(100%+0.75rem)] z-50 w-80 max-w-sm max-h-[70vh] overflow-y-auto rounded-3xl border border-slate-200 bg-white/95 p-6 pr-5 text-left shadow-2xl shadow-slate-200/80"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">
                  Command Center
                </p>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
                >
                  Close
                </button>
              </div>
              <nav className="mt-4 space-y-2">
                {menuLinks.map((link) => (
                  <button
                    key={link.id}
                    type="button"
                    onClick={() => handleMenuLinkClick(link)}
                    className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm font-medium transition ${
                      link.accent
                        ? 'border-indigo-200 bg-gradient-to-r from-indigo-100 to-sky-100 text-indigo-700 shadow-sm shadow-indigo-100/70'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600'
                    }`}
                  >
                    {link.icon ? (
                      <link.icon className="h-4 w-4" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    {link.label}
                  </button>
                ))}
              </nav>
              {menuContent && (
                <div className="mt-6 rounded-2xl border border-slate-200 bg-white/90 p-4">
                  {menuContent}
                </div>
              )}
              <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                  Theme
                </p>
                <div className="mt-3 space-y-2">
                  {themeOptions.map((option) => {
                    const isActive = option.id === themeId
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setTheme(option.id)}
                        className={`flex w-full items-center justify-between rounded-2xl border px-3 py-3 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 ${
                          isActive
                            ? 'border-indigo-300 bg-white text-indigo-600 shadow-sm shadow-indigo-100'
                            : 'border-slate-200 bg-white/80 text-slate-600 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600'
                        }`}
                        aria-pressed={isActive}
                      >
                        <span className="font-semibold">{option.label}</span>
                        <span
                          className="h-9 w-9 rounded-2xl border border-slate-200 shadow-inner shadow-slate-200/60"
                          style={{
                            backgroundColor: option.backgroundColor,
                            backgroundImage: option.backgroundImage ?? undefined,
                          }}
                          aria-hidden="true"
                        />
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      {children && (
        <div className={childrenWrapperClassName}>
          {children}
        </div>
      )}
    </header>
  )
}
