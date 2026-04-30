'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { useSearchParams } from 'next/navigation'

import { getBrowserSupabaseClient } from '@/lib/supabase/client'

function normalizeNextPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return '/'
  }

  return value
}

export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [codeSent, setCodeSent] = useState(false)
  const [pending, startTransition] = useTransition()
  const next = normalizeNextPath(searchParams.get('next'))
  const callbackError = searchParams.get('error')

  const sendLoginEmail = () => {
    setError(null)
    setMessage(null)

    startTransition(async () => {
      const supabase = getBrowserSupabaseClient()
      const redirectTarget = new URL('/auth/confirm', window.location.origin)
      redirectTarget.searchParams.set('next', next)

      const { error: signInError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: redirectTarget.toString(),
        },
      })

      if (signInError) {
        setError(signInError.message)
        return
      }

      setCodeSent(true)
      setCode('')
      setMessage('验证码已发送到邮箱，请在下方输入。We sent a sign-in code to your email.')
    })
  }

  const handleSendSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    sendLoginEmail()
  }

  const handleVerifySubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setMessage(null)

    startTransition(async () => {
      const supabase = getBrowserSupabaseClient()
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: 'email',
      })

      if (verifyError) {
        setError(verifyError.message)
        return
      }

      setMessage('已登录，正在跳转。Signed in. Redirecting...')
      router.refresh()
      window.location.assign(next)
    })
  }

  return (
    <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6">
      <div className="mb-6">
        <div className="text-xs uppercase tracking-[0.28em] text-cyan-200/70">邮箱验证码登录 / Passwordless sign-in</div>
        <h2 className="mt-2 text-3xl font-semibold text-white">登录 PhysicsOS Cloud，解锁邀请制运行 / Sign in to unlock invited runs</h2>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          输入邮箱获取验证码。首次登录会自动创建账号；真正的运行权限由邀请码兑换后的额度控制。
          Enter your email to receive a code. Run access is controlled by redeemed invite credits.
        </p>
      </div>

      <form className="space-y-4" onSubmit={handleSendSubmit}>
        <label className="block">
          <span className="mb-2 block text-sm text-slate-300">邮箱 / Email</span>
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
          {pending ? '发送中 / Sending...' : codeSent ? '重发验证码 / Resend code' : '发送验证码 / Send sign-in code'}
        </button>
      </form>

      {codeSent ? (
        <form className="mt-5 space-y-4 rounded-[24px] border border-white/10 bg-black/20 p-4" onSubmit={handleVerifySubmit}>
          <div>
            <div className="text-xs uppercase tracking-[0.24em] text-cyan-200/70">输入邮箱验证码 / Enter email code</div>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              即使邮件在另一台设备打开，也可以直接复制验证码完成登录。This works across browsers and devices.
            </p>
          </div>

          <label className="block">
            <span className="mb-2 block text-sm text-slate-300">邮箱验证码 / Code from email</span>
            <input
              autoComplete="one-time-code"
              className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/60"
              inputMode="text"
              onChange={(event) => setCode(event.target.value)}
              placeholder="输入邮件中的验证码 / Enter the code exactly"
              required
              type="text"
              value={code}
            />
          </label>

          <button
            className="w-full rounded-full border border-cyan-300/40 px-5 py-3 text-sm font-semibold text-cyan-100 transition hover:border-cyan-200 hover:text-white disabled:cursor-wait disabled:opacity-60"
            disabled={pending}
            type="submit"
          >
            {pending ? '验证中 / Verifying...' : '用验证码登录 / Sign in with code'}
          </button>
        </form>
      ) : null}

      {callbackError === 'invalid_callback' ? (
        <p className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
          登录链接无效或已过期。请重新发送邮件，并使用邮件中的验证码。That sign-in link is invalid or expired.
        </p>
      ) : null}
      {error ? <p className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-300/10 px-4 py-3 text-sm text-rose-100">{error}</p> : null}
      {message ? <p className="mt-4 rounded-2xl border border-emerald-300/20 bg-emerald-300/10 px-4 py-3 text-sm text-emerald-100">{message}</p> : null}

      <div className="mt-6 text-sm leading-6 text-slate-400">
        建议使用邮件验证码完成登录，避免 magic link 跨浏览器失效。Use the email code to avoid magic-link browser issues.
      </div>

      <div className="mt-4 text-sm text-slate-400">
        登录后需要运行额度？<Link className="text-cyan-200 underline" href="/redeem">在这里兑换邀请码 / Redeem here</Link>.
      </div>
    </div>
  )
}
