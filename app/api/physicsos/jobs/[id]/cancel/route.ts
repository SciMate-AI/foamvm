import { NextRequest, NextResponse } from 'next/server'

import { verifyCliBearerToken } from '@/lib/cli-auth'
import { appendRunEvent, getUserRunConsumption } from '@/lib/runs'
import { killSandbox } from '@/lib/sandbox'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { updateRunConsumption } from '@/lib/run-tokens'

export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const verified = await verifyCliBearerToken(request.headers.get('authorization'))
  if (!verified || !verified.scopes.includes('runner:cancel')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const run = await getUserRunConsumption({ consumptionId: id, userId: verified.userId })
  if (!run) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (run.sandboxSessionId) {
    await killSandbox(run.sandboxSessionId)
  }

  await updateRunConsumption({
    consumptionId: run.id,
    status: 'failed',
    sandboxSessionId: run.sandboxSessionId,
    commandPid: run.commandPid,
    errorMessage: 'PhysicsOS job cancelled by CLI.',
  })

  await appendRunEvent({
    consumptionId: run.id,
    payload: { type: 'error', message: 'PhysicsOS job cancelled by CLI.' },
  })

  const admin = createAdminSupabaseClient()
  await admin
    .from('usage_ledger')
    .update({ status: 'cancelled' })
    .eq('consumption_id', run.id)
    .eq('user_id', verified.userId)

  return NextResponse.json({ cancelled: true })
}
