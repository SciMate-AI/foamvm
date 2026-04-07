'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useSearchParams } from 'next/navigation'

import { getBrowserSupabaseClient } from '@/lib/supabase/client'

export function LoginForm() {
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const next = searchParams.get('next') || '/'

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setMessage(null)

    startTransition(async () => {
      const supabase = getBrowserSupabaseClient()
      const redirectTarget = new URL('/auth/confirm', window.location.origin)
      redirectTarget.searchParams.set('next', next)

      const { error: signInError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirectTarget.toString(),
        },
      })

      if (signInError) {
        setError(signInError.message)
        return
      }

      setMessage('Check your email for the magic link. Opening it here will create the session.')
    })
  }

  return (
    <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6">
      <div className="mb-6">
        <div className="text-xs uppercase tracking-[0.28em] text-cyan-200/70">Email magic link</div>
        <h2 className="mt-2 text-3xl font-semibold text-white">Sign in to unlock invited runs</h2>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          Accounts are lightweight. The actual gate is your run-token balance, not public signup.
        </p>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <label className="block">
          <span className="mb-2 block text-sm text-slate-300">Email</span>
          <input
            autoComplete="email"
            className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/60"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
            type="email"
            value={email}
          />
        </label>

        <button
          className="w-full rounded-full bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-wait disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? 'Sending magic link...' : 'Send magic link'}
        </button>
      </form>

      {error ? <p className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-300/10 px-4 py-3 text-sm text-rose-100">{error}</p> : null}
      {message ? <p className="mt-4 rounded-2xl border border-emerald-300/20 bg-emerald-300/10 px-4 py-3 text-sm text-emerald-100">{message}</p> : null}

      <div className="mt-6 text-sm text-slate-400">
        Need a token after login? <Link className="text-cyan-200 underline" href="/redeem">Redeem one here</Link>.
      </div>
    </div>
  )
}
