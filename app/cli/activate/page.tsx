import Link from 'next/link'

import { approveCliDeviceAction } from './actions'
import { getViewerContext } from '@/lib/auth'

export default async function CliActivatePage({
  searchParams,
}: {
  searchParams: Promise<{ user_code?: string }>
}) {
  const params = await searchParams
  const userCode = params.user_code || ''
  const viewer = await getViewerContext()

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,_#020617_0%,_#0f172a_100%)] px-4 py-12 text-slate-100">
      <div className="mx-auto max-w-2xl rounded-[32px] border border-white/10 bg-white/[0.04] p-8">
        <div className="text-xs uppercase tracking-[0.28em] text-cyan-200/70">PhysicsOS CLI / 命令行授权</div>
        <h1 className="mt-3 text-3xl font-semibold text-white">授权这台命令行设备 / Authorize this CLI device</h1>
        <p className="mt-4 text-sm leading-6 text-slate-300">
          在 CLI 中运行 <code className="rounded bg-black/30 px-2 py-1">physicsos auth login</code> 后，
          把显示的设备码填到这里。邀请码只用于增加运行额度，不会暴露给 CLI。
        </p>

        {!viewer.user ? (
          <div className="mt-6 rounded-3xl border border-amber-300/20 bg-amber-300/10 p-5 text-sm text-amber-50">
            请先登录 foamvm 账号再授权 CLI。
            <div className="mt-4">
            <Link className="rounded-full bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950" href={`/auth/login?next=${encodeURIComponent(`/cli/activate?user_code=${userCode}`)}`}>
                登录 / Sign in
              </Link>
            </div>
          </div>
        ) : null}

        {viewer.user && viewer.availableRuns <= 0 ? (
          <div className="mt-6 rounded-3xl border border-amber-300/20 bg-amber-300/10 p-5 text-sm text-amber-50">
            当前账号没有可用运行次数。你仍可授权 CLI，但提交 full solver job 前需要先兑换邀请码。
            No run credits are available. You may authorize CLI now, but solver jobs require redeemed credits.
            <div className="mt-4">
              <Link className="rounded-full border border-amber-200/40 px-4 py-2 text-sm text-amber-50" href="/redeem">
                兑换邀请码 / Redeem invite
              </Link>
            </div>
          </div>
        ) : null}

        <form action={approveCliDeviceAction} className="mt-8 space-y-4">
          <label className="block text-sm text-slate-300" htmlFor="user_code">
            设备码 / Device code
          </label>
          <input
            className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-lg uppercase tracking-[0.24em] text-white outline-none transition focus:border-cyan-200/60"
            defaultValue={userCode}
            id="user_code"
            name="user_code"
            placeholder="AB12-CD34"
            required
          />
          <button
            className="rounded-full bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:opacity-50"
            disabled={!viewer.user}
            type="submit"
          >
            授权 CLI / Authorize CLI
          </button>
        </form>
      </div>
    </main>
  )
}
