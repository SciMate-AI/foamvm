import Link from 'next/link'

import { signOutAction } from '@/app/actions/auth'
import { getViewerContext, requireAuthenticatedUser } from '@/lib/auth'
import { listUserRunHistory } from '@/lib/run-tokens'

export default async function AccountPage() {
  const user = await requireAuthenticatedUser('/account')
  const [viewer, history] = await Promise.all([
    getViewerContext(),
    listUserRunHistory(user.id),
  ])

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,_#020617_0%,_#0f172a_100%)] px-4 py-12 text-slate-100">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex flex-wrap items-center gap-3">
          <Link className="rounded-full border border-white/10 px-3 py-1 text-sm text-slate-300 transition hover:border-white/30 hover:text-white" href="/">
            Back to home
          </Link>
          <Link className="rounded-full border border-white/10 px-3 py-1 text-sm text-slate-300 transition hover:border-white/30 hover:text-white" href="/redeem">
            Redeem token
          </Link>
          <form action={signOutAction}>
            <button className="rounded-full border border-rose-300/20 bg-rose-300/10 px-3 py-1 text-sm text-rose-100 transition hover:border-rose-200/40" type="submit">
              Sign out
            </button>
          </form>
        </div>

        <section className="mb-6 rounded-[28px] border border-white/10 bg-white/[0.03] p-6">
          <div className="text-xs uppercase tracking-[0.28em] text-cyan-200/70">Account</div>
          <h1 className="mt-2 text-3xl font-semibold text-white">{viewer.user?.email}</h1>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
              <div className="text-sm text-slate-400">Ready runs</div>
              <div className="mt-2 text-4xl font-semibold text-white">{viewer.availableRuns}</div>
            </div>
            <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
              <div className="text-sm text-slate-400">Consumed runs</div>
              <div className="mt-2 text-4xl font-semibold text-white">{viewer.consumedRuns}</div>
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6">
          <div className="text-xs uppercase tracking-[0.28em] text-cyan-200/70">Recent runs</div>
          <div className="mt-5 space-y-3">
            {history.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-white/10 bg-black/10 px-5 py-6 text-sm text-slate-500">
                No runs recorded yet.
              </div>
            ) : history.map((item) => (
              <div className="rounded-3xl border border-white/10 bg-black/20 p-5" key={item.id}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm text-white">{item.promptExcerpt || 'No prompt excerpt saved.'}</div>
                  <div className="rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.24em] text-slate-300">
                    {item.status}
                  </div>
                </div>
                <div className="mt-3 text-xs text-slate-500">
                  Started {new Date(item.createdAt).toLocaleString()}
                  {item.sandboxSessionId ? ` · Sandbox ${item.sandboxSessionId.slice(0, 12)}...` : ''}
                </div>
                {item.errorMessage ? (
                  <div className="mt-3 rounded-2xl border border-rose-300/20 bg-rose-300/10 px-4 py-3 text-sm text-rose-100">
                    {item.errorMessage}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
