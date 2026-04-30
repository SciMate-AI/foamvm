'use client'

import { useActionState } from 'react'

import type { FormState } from '@/app/actions/tokens'
import { generateRunTokensAction } from '@/app/actions/tokens'

const initialState: FormState = {
  success: false,
  message: '',
}

export function GenerateTokensForm() {
  const [state, action, pending] = useActionState(generateRunTokensAction, initialState)

  return (
    <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6">
      <div className="mb-5">
        <div className="text-xs uppercase tracking-[0.28em] text-amber-200/70">管理员发码 / Admin issue flow</div>
        <h2 className="mt-2 text-2xl font-semibold text-white">生成一次性运行邀请码 / Generate one-time run tokens</h2>
      </div>

      <form action={action} className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="mb-2 block text-sm text-slate-300">数量 / Quantity</span>
          <input className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none focus:border-amber-300/60" defaultValue="5" name="quantity" max="100" min="1" required type="number" />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm text-slate-300">指定邮箱（可选）/ Assigned email</span>
          <input className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none focus:border-amber-300/60" name="assignedEmail" placeholder="friend@example.com" type="email" />
        </label>
        <label className="block md:col-span-2">
          <span className="mb-2 block text-sm text-slate-300">备注（可选）/ Note</span>
          <input className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none focus:border-amber-300/60" name="note" placeholder="April private beta" type="text" />
        </label>
        <label className="block md:col-span-2">
          <span className="mb-2 block text-sm text-slate-300">过期时间（可选）/ Expiry</span>
          <input className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none focus:border-amber-300/60" name="expiresAt" type="datetime-local" />
        </label>
        <div className="md:col-span-2">
          <button className="rounded-full bg-amber-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-amber-200 disabled:cursor-wait disabled:opacity-60" disabled={pending} type="submit">
            {pending ? '生成中 / Generating...' : '生成邀请码 / Generate tokens'}
          </button>
        </div>
      </form>

      {state.message ? (
        <div className={`mt-5 rounded-3xl px-4 py-4 text-sm ${state.success ? 'border border-emerald-300/20 bg-emerald-300/10 text-emerald-50' : 'border border-rose-300/20 bg-rose-300/10 text-rose-100'}`}>
          <p>{state.message}</p>
          {state.codes?.length ? (
            <pre className="mt-3 overflow-x-auto rounded-2xl border border-white/10 bg-black/30 p-4 text-xs text-slate-100">
              {state.codes.join('\n')}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
