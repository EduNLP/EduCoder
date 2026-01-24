'use client'

import type { ChangeEvent, FormEvent } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Lock, LogIn, Users } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTheme } from '@/context/ThemeContext'
import { useAuth, useSignIn, useUser } from '@clerk/nextjs'

type LoginFormState = {
  username: string
  password: string
  remember: boolean
}

export default function LoginView() {
  const router = useRouter()
  const { theme } = useTheme()
  const { isLoaded, signIn, setActive } = useSignIn()
  const { isLoaded: authLoaded, isSignedIn } = useAuth()
  const { isLoaded: userLoaded, user } = useUser()
  const role = user?.publicMetadata?.role as string | undefined
  const [formState, setFormState] = useState<LoginFormState>({
    username: '',
    password: '',
    remember: true,
  })
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const pageBackgroundStyle = useMemo(
    () => ({
      backgroundColor: theme.backgroundColor,
      backgroundImage: theme.backgroundImage ?? 'none',
    }),
    [theme],
  )

  useEffect(() => {
    if (!authLoaded || !userLoaded || !isSignedIn) {
      return
    }

    const destination = role === 'admin' ? '/admin' : '/workspace'
    router.replace(destination)
  }, [authLoaded, isSignedIn, router, role, userLoaded])

  const handleTextFieldChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target
    if (error) {
      setError(null)
    }
    setFormState((previous) => ({
      ...previous,
      [name as 'username' | 'password']: value,
    }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (authLoaded && isSignedIn) {
      window.location.reload()
      return
    }

    const normalizedUsername = formState.username.trim().toLowerCase()
    const trimmedPassword = formState.password.trim()

    if (!normalizedUsername || !trimmedPassword) {
      setError('Please enter both a username and password.')
      return
    }

    if (!isLoaded) {
      setError('Authentication is still loading. Please try again.')
      return
    }

    if (!setActive) {
      setError('Authentication is not ready. Please try again.')
      return
    }

    if (!signIn) {
      setError('Sign-in service is not available. Please try again.')
      return
    }

    setError(null)
    setIsSubmitting(true)

    try {
      const result = await signIn.create({
        identifier: normalizedUsername,
        password: trimmedPassword,
      })

      if (result.status === 'complete' && result.createdSessionId) {
        await setActive({ session: result.createdSessionId })
        return // Redirect happens in the signed-in effect once the user loads
      }

      if (result.status === 'needs_second_factor') {
        setError('Additional verification is required to complete sign in.')
        return
      }

      setError('Unable to sign in right now. Please try again.')
    } catch (signInError: unknown) {
      const clerkErrors =
        (signInError as { errors?: Array<{ message?: string; code?: string }> })
          ?.errors
      const message =
        Array.isArray(clerkErrors) && clerkErrors[0]?.message
          ? clerkErrors[0]?.message
          : 'Invalid username or password. Please try again.'

      console.error('Clerk sign-in failed', signInError)
      const messageLower = message.toLowerCase()
      if (
        messageLower.includes('session') &&
        (messageLower.includes('exist') || messageLower.includes('active'))
      ) {
        window.location.reload()
        return
      }
      setError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4 py-12 text-slate-900 sm:px-6 lg:px-8"
      style={pageBackgroundStyle}
    >
      <div className="w-full max-w-xl">
        <form
          onSubmit={handleSubmit}
          className="flex flex-col rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-xl shadow-slate-200/70 sm:p-8"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-500">
              Sign in
            </p>
            <h2 className="mt-3 text-2xl font-semibold text-slate-900">
              Log into your workspace
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Use your assigned credentials to continue.
            </p>
          </div>

          <div className="mt-6 flex flex-col gap-5">
            <label className="flex flex-col gap-2 text-sm font-semibold text-slate-600">
              Username
              <div className="relative">
                <Users className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  name="username"
                  value={formState.username}
                  onChange={handleTextFieldChange}
                  placeholder="e.g., facilitator@district.org"
                  className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-12 pr-4 text-base text-slate-900 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                  autoComplete="username"
                />
              </div>
            </label>

            <label className="flex flex-col gap-2 text-sm font-semibold text-slate-600">
              Password
              <div className="relative">
                <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="password"
                  name="password"
                  value={formState.password}
                  onChange={handleTextFieldChange}
                  placeholder="Enter your password"
                  className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-12 pr-4 text-base text-slate-900 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                  autoComplete="current-password"
                />
              </div>
            </label>

            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <label className="inline-flex items-center gap-2 text-slate-600">
                <input
                  type="checkbox"
                  checked={formState.remember}
                  onChange={(event) =>
                    setFormState((previous) => ({
                      ...previous,
                      remember: event.target.checked,
                    }))
                  }
                  className="h-4 w-4 rounded border-slate-300 text-indigo-500 focus:ring-indigo-200"
                />
                Remember me
              </label>
              <button
                type="button"
                className="text-sm font-semibold text-indigo-600 underline-offset-4 transition hover:text-indigo-500"
              >
                Forgot password?
              </button>
            </div>

            {error && (
              <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={isSubmitting || !isLoaded}
              className="mt-2 flex items-center justify-center gap-2 rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-500 to-sky-500 px-4 py-3 text-base font-semibold text-white shadow-lg shadow-indigo-200/70 transition hover:from-indigo-500/90 hover:to-sky-500/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <LogIn className="h-4 w-4" />
              {isSubmitting ? 'Signing in…' : isLoaded ? 'Sign in' : 'Loading…'}
            </button>

            <p className="text-center text-xs text-slate-500">
              By signing in you agree to keep transcript data confidential.
            </p>
          </div>
        </form>
      </div>
    </div>
  )
}
