import { NextRequest, NextResponse } from 'next/server'

import { verifyCliBearerToken } from '@/lib/cli-auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const verified = await verifyCliBearerToken(request.headers.get('authorization'))
  if (!verified || !verified.scopes.includes('account:read')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminSupabaseClient()
  const [{ data: profile }, { count: availableRuns }, { count: consumedRuns }] = await Promise.all([
    admin.from('profiles').select('id, email, role').eq('id', verified.userId).single(),
    admin.from('run_tokens').select('*', { head: true, count: 'exact' }).eq('redeemed_by', verified.userId).eq('status', 'redeemed'),
    admin.from('run_tokens').select('*', { head: true, count: 'exact' }).eq('redeemed_by', verified.userId).eq('status', 'consumed'),
  ])

  return NextResponse.json({
    user: {
      id: verified.userId,
      email: profile?.email ?? null,
      role: profile?.role ?? 'user',
    },
    quota: {
      available_runs: availableRuns ?? 0,
      consumed_runs: consumedRuns ?? 0,
      max_parallel_jobs: 1,
    },
    allowed_backends: ['openfoam'],
    allowed_solvers: ['icoFoam', 'simpleFoam'],
  })
}
