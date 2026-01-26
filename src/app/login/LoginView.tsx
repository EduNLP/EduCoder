'use client'

import type { ChangeEvent, FormEvent, MouseEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Lock, LogIn, Users } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTheme } from '@/context/ThemeContext'
import { useAuth, useSignIn, useSignUp, useUser } from '@clerk/nextjs'

type LoginFormState = {
  username: string
  password: string
  remember: boolean
}

type LoginMode = 'email' | 'workspace'

export default function LoginView() {
  const router = useRouter()
  const { theme } = useTheme()
  const { isLoaded: signInLoaded, signIn, setActive } = useSignIn()
  const { isLoaded: signUpLoaded, signUp } = useSignUp()
  const { isLoaded: authLoaded, isSignedIn } = useAuth()
  const { isLoaded: userLoaded, user } = useUser()
  const role = user?.publicMetadata?.role as string | undefined
  const [loginMode, setLoginMode] = useState<LoginMode>('email')
  const [emailEntry, setEmailEntry] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [isEmailSubmitting, setIsEmailSubmitting] = useState(false)
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

  const syncTriggeredRef = useRef(false)

  useEffect(() => {
    if (!authLoaded || !userLoaded || !isSignedIn) {
      return
    }

    if (syncTriggeredRef.current) {
      return
    }
    syncTriggeredRef.current = true

    const syncUser = async () => {
      try {
        const response = await fetch('/api/auth/ensure-user', { method: 'POST' })
        const payload = await response.json().catch(() => null)

        if (!response.ok) {
          syncTriggeredRef.current = false
          const message =
            payload?.error ??
            'Unable to complete sign-in right now. Please try again.'
          setError(message)
          setEmailError(message)
          return
        }

        if (user?.reload) {
          await user.reload()
        }

        const resolvedRole =
          (payload?.role as string | undefined) ?? role ?? 'user'
        const destination = resolvedRole === 'admin' ? '/admin' : '/workspace'
        router.replace(destination)
      } catch (syncError) {
        console.error('Failed to sync auth user', syncError)
        syncTriggeredRef.current = false
        const message = 'Unable to complete sign-in right now. Please try again.'
        setError(message)
        setEmailError(message)
      }
    }

    void syncUser()
  }, [authLoaded, isSignedIn, role, router, user, userLoaded])

  const openWorkspaceLogin = (prefillEmail?: string) => {
    const normalizedEmail = prefillEmail?.trim().toLowerCase() ?? ''
    if (normalizedEmail) {
      setFormState((previous) => ({
        ...previous,
        username: normalizedEmail,
      }))
    }
    setEmailError(null)
    setError(null)
    setLoginMode('workspace')
  }

  const handleEmailSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (authLoaded && isSignedIn) {
      window.location.reload()
      return
    }

    const normalizedEmail = emailEntry.trim().toLowerCase()
    if (!normalizedEmail) {
      setEmailError('Enter your email address to continue.')
      return
    }

    if (!signInLoaded || !signUpLoaded) {
      setEmailError('Authentication is still loading. Please try again.')
      return
    }

    if (!signIn || !signUp) {
      setEmailError('Authentication is not ready. Please try again.')
      return
    }

    setEmailError(null)
    setError(null)
    setIsEmailSubmitting(true)

    const redirectUrl = `${window.location.origin}/login`
    const getClerkError = (signInError: unknown) => {
      const clerkErrors =
        (signInError as {
          errors?: Array<{ message?: string; code?: string }>
        })?.errors
      const firstError = Array.isArray(clerkErrors) ? clerkErrors[0] : undefined

      return {
        code: firstError?.code,
        message: firstError?.message,
      }
    }

    try {
      await signIn.create({
        strategy: 'email_link',
        identifier: normalizedEmail,
        redirectUrl,
      })
      window.alert(`Dev: Magic sign-in link sent to ${normalizedEmail}.`)
      return
    } catch (signInError: unknown) {
      const { code, message } = getClerkError(signInError)
      if (code?.startsWith('form_identifier_not_found')) {
        try {
          await signUp.create({ emailAddress: normalizedEmail })
          await signUp.prepareEmailAddressVerification({
            strategy: 'email_link',
            redirectUrl,
          })
          window.alert(`Dev: Magic sign-up link sent to ${normalizedEmail}.`)
          return
        } catch (signUpError: unknown) {
          const signUpInfo = getClerkError(signUpError)
          if (signUpInfo.code?.startsWith('form_identifier_exists')) {
            try {
              await signIn.create({
                strategy: 'email_link',
                identifier: normalizedEmail,
                redirectUrl,
              })
              window.alert(`Dev: Magic sign-in link sent to ${normalizedEmail}.`)
              return
            } catch (retryError: unknown) {
              const retryInfo = getClerkError(retryError)
              setEmailError(
                retryInfo.message ??
                  'Unable to send a magic link right now. Please try again.',
              )
              return
            }
          }

          setEmailError(
            signUpInfo.message ??
              'Unable to create an account right now. Please try again.',
          )
          return
        }
      }

      setEmailError(
        message ?? 'Unable to send a magic link right now. Please try again.',
      )
    } finally {
      setIsEmailSubmitting(false)
    }
  }

  const handleWorkspaceLoginClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    openWorkspaceLogin(emailEntry)
  }

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

    if (!signInLoaded) {
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
        {loginMode === 'email' ? (
          <form
            onSubmit={handleEmailSubmit}
            className="flex flex-col rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-xl shadow-slate-200/70 sm:p-8"
          >
            <div>
              <h1 className="text-3xl font-semibold text-slate-900">EduCoder</h1>
            </div>

            <div className="mt-6 flex flex-col gap-5">
              <label className="flex flex-col gap-2 text-sm font-semibold text-slate-600">
                Enter your email address
                <input
                  type="email"
                  name="email"
                  value={emailEntry}
                  onChange={(event) => {
                    setEmailEntry(event.target.value)
                    if (emailError) {
                      setEmailError(null)
                    }
                  }}
                  placeholder="you@school.org"
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                  autoComplete="email"
                />
              </label>

              {emailError && (
                <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
                  {emailError}
                </p>
              )}

              <button
                type="submit"
                disabled={isEmailSubmitting || !signInLoaded || !signUpLoaded}
                className="mt-2 flex items-center justify-center gap-2 rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-500 to-sky-500 px-4 py-3 text-base font-semibold text-white shadow-lg shadow-indigo-200/70 transition hover:from-indigo-500/90 hover:to-sky-500/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isEmailSubmitting
                  ? 'Sending link…'
                  : signInLoaded && signUpLoaded
                    ? 'Continue'
                    : 'Loading…'}
              </button>

              <button
                type="button"
                onClick={handleWorkspaceLoginClick}
                className="text-sm font-semibold text-slate-600 underline-offset-4 transition hover:text-slate-900"
              >
                Join a workspace
              </button>
            </div>
          </form>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="flex flex-col rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-xl shadow-slate-200/70 sm:p-8"
          >
            <div>
              <button
                type="button"
                onClick={() => {
                  setError(null)
                  setEmailError(null)
                  setLoginMode('email')
                }}
                className="inline-flex items-center justify-center text-slate-500 transition hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
                aria-label="Back"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
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

              {error && (
                <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={isSubmitting || !signInLoaded}
                className="mt-2 flex items-center justify-center gap-2 rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-500 to-sky-500 px-4 py-3 text-base font-semibold text-white shadow-lg shadow-indigo-200/70 transition hover:from-indigo-500/90 hover:to-sky-500/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <LogIn className="h-4 w-4" />
                {isSubmitting
                  ? 'Signing in…'
                  : signInLoaded
                    ? 'Sign in'
                    : 'Loading…'}
              </button>

            </div>
          </form>
        )}
      </div>
    </div>
  )
}
