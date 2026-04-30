import { NextRequest, NextResponse } from 'next/server'

import { verifyCliBearerToken } from '@/lib/cli-auth'
import { consumeRunTokenForUser } from '@/lib/run-tokens'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { startPhysicsOSOpenFOAMJob, validatePhysicsOSManifest } from '@/lib/physicsos-runner'

export const runtime = 'nodejs'
export const maxDuration = 800

export async function POST(request: NextRequest) {
  const verified = await verifyCliBearerToken(request.headers.get('authorization'))
  if (!verified || !verified.scopes.includes('runner:submit')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let manifest
  try {
    manifest = validatePhysicsOSManifest(await request.json())
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }

  const consumeResult = await consumeRunTokenForUser({
    userId: verified.userId,
    promptExcerpt: `PhysicsOS ${manifest.backend}:${manifest.openfoam?.solver || manifest.backend_command} ${manifest.problem_id}`,
  })

  if (!consumeResult.success || !consumeResult.consumptionId) {
    return NextResponse.json({ error: consumeResult.message }, { status: 403 })
  }

  const admin = createAdminSupabaseClient()
  await admin
    .from('run_consumptions')
    .update({
      source: 'physicsos_cli',
      backend: manifest.backend,
      solver: manifest.openfoam?.solver || manifest.backend_command || null,
      job_manifest: manifest,
    })
    .eq('id', consumeResult.consumptionId)

  await admin.from('usage_ledger').insert({
    user_id: verified.userId,
    consumption_id: consumeResult.consumptionId,
    provider: 'e2b',
    backend: manifest.backend,
    estimated_cost_usd: null,
    runtime_seconds: null,
    output_bytes: null,
    status: 'starting',
  })

  await startPhysicsOSOpenFOAMJob({
    runId: consumeResult.consumptionId,
    userId: verified.userId,
    manifest,
    remainingRuns: consumeResult.remainingRuns,
  })

  return NextResponse.json({
    job_id: consumeResult.consumptionId,
    status: 'starting',
    remaining_runs: consumeResult.remainingRuns,
  })
}
