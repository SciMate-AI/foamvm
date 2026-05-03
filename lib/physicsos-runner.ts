import { CommandExitError } from 'e2b'

import { appendRunEvent } from '@/lib/runs'
import { collectOutputFiles, createCFDSandbox, killSandbox } from '@/lib/sandbox'
import { updateRunConsumption, uploadRunOutputs } from '@/lib/run-tokens'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ALLOWED_OPENFOAM_SOLVERS = new Set(['icoFoam', 'simpleFoam'])
const SAFE_PATH = /^[A-Za-z0-9._/-]+$/

export interface PhysicsOSManifest {
  schema_version: string
  problem_id: string
  backend: string
  backend_command?: string | null
  budget?: {
    max_wall_time_seconds?: number
    max_memory_gb?: number
  }
  openfoam?: {
    solver?: string
    case_files?: Array<{ path: string; content: string }>
  }
}

export function validatePhysicsOSManifest(value: unknown): PhysicsOSManifest {
  const manifest = value as Partial<PhysicsOSManifest>
  if (manifest.schema_version !== 'physicsos.full_solver_job.v1') {
    throw new Error('Unsupported manifest schema_version.')
  }
  if (manifest.backend !== 'openfoam') {
    throw new Error('Only backend=openfoam is enabled.')
  }

  const solver = manifest.openfoam?.solver || manifest.backend_command
  if (!solver || !ALLOWED_OPENFOAM_SOLVERS.has(solver)) {
    throw new Error(`OpenFOAM solver is not allowed: ${solver || '(missing)'}`)
  }

  const files = manifest.openfoam?.case_files
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('openfoam.case_files is required.')
  }

  for (const file of files) {
    if (!file.path || !SAFE_PATH.test(file.path) || file.path.startsWith('/') || file.path.includes('..')) {
      throw new Error(`Unsafe case file path: ${file.path}`)
    }
    if (typeof file.content !== 'string') {
      throw new Error(`Case file content must be a string: ${file.path}`)
    }
  }

  return manifest as PhysicsOSManifest
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function runCommand(params: {
  runId: string
  sandbox: Awaited<ReturnType<typeof createCFDSandbox>>['sandbox']
  command: string
  timeoutMs: number
}) {
  await appendRunEvent({ consumptionId: params.runId, payload: { type: 'log', text: `$ ${params.command}` } })
  try {
    const result = await params.sandbox.commands.run(params.command, {
      cwd: '/workspace/case',
      timeoutMs: params.timeoutMs,
    })
    if (result.stdout.trim()) {
      await appendRunEvent({ consumptionId: params.runId, payload: { type: 'log', text: result.stdout.slice(-4000) } })
    }
    if (result.stderr.trim()) {
      await appendRunEvent({ consumptionId: params.runId, payload: { type: 'stderr', text: result.stderr.slice(-4000) } })
    }
  } catch (error) {
    if (error instanceof CommandExitError) {
      throw new Error(
        `Command failed: ${params.command}\nstdout: ${error.stdout?.slice(-1000) || ''}\nstderr: ${error.stderr?.slice(-1000) || ''}`,
      )
    }
    throw error
  }
}

export async function startPhysicsOSOpenFOAMJob(params: {
  runId: string
  userId: string
  manifest: PhysicsOSManifest
  remainingRuns: number
}) {
  return runPhysicsOSOpenFOAMJob(params)
}

async function runPhysicsOSOpenFOAMJob(params: {
  runId: string
  userId: string
  manifest: PhysicsOSManifest
  remainingRuns: number
}) {
  let sessionId: string | null = null

  try {
    await appendRunEvent({ consumptionId: params.runId, payload: { type: 'credit', remainingRuns: params.remainingRuns } })
    await appendRunEvent({ consumptionId: params.runId, payload: { type: 'status', message: 'Creating PhysicsOS OpenFOAM sandbox...' } })
    const { sandbox, sessionId: createdSessionId } = await createCFDSandbox()
    sessionId = createdSessionId
    const solver = params.manifest.openfoam?.solver || params.manifest.backend_command || 'icoFoam'

    await updateRunConsumption({
      consumptionId: params.runId,
      status: 'running',
      sandboxSessionId: sessionId,
      errorMessage: null,
    })

    await sandbox.commands.run('rm -rf /workspace/case /workspace/output && mkdir -p /workspace/case /workspace/output', { timeoutMs: 10000 })
    for (const file of params.manifest.openfoam?.case_files ?? []) {
      await sandbox.commands.run(`mkdir -p /workspace/case/${shellQuote(file.path.split('/').slice(0, -1).join('/') || '.')}`, { timeoutMs: 10000 })
      await sandbox.files.write(`/workspace/case/${file.path}`, file.content)
    }

    const wallSeconds = Math.min(Math.max(Number(params.manifest.budget?.max_wall_time_seconds ?? 600), 30), 1800)
    const timeoutMs = wallSeconds * 1000
    await runCommand({ runId: params.runId, sandbox, command: 'blockMesh | tee /workspace/output/log.blockMesh', timeoutMs })
    await runCommand({ runId: params.runId, sandbox, command: `${solver} | tee /workspace/output/log.${solver}`, timeoutMs })
    await runCommand({ runId: params.runId, sandbox, command: 'foamToVTK | tee /workspace/output/log.foamToVTK', timeoutMs })
    await runCommand({ runId: params.runId, sandbox, command: 'tar -czf /workspace/output/VTK.tar.gz VTK', timeoutMs: 60000 })

    const files = await collectOutputFiles(sandbox)
    await uploadRunOutputs({ userId: params.userId, consumptionId: params.runId, files })
    const outputBytes = files.reduce((total, file) => total + file.size, 0)
    await updateRunConsumption({
      consumptionId: params.runId,
      status: 'completed',
      sandboxSessionId: sessionId,
      errorMessage: null,
    })
    await createAdminSupabaseClient()
      .from('usage_ledger')
      .update({
        status: 'completed',
        output_bytes: outputBytes,
      })
      .eq('consumption_id', params.runId)
    await appendRunEvent({ consumptionId: params.runId, payload: { type: 'done', sessionId } })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await updateRunConsumption({
      consumptionId: params.runId,
      status: 'failed',
      sandboxSessionId: sessionId,
      errorMessage: message,
    }).catch(() => {})
    try {
      await createAdminSupabaseClient()
        .from('usage_ledger')
        .update({ status: 'failed' })
        .eq('consumption_id', params.runId)
    } catch {
      // Keep the primary run failure visible even if ledger update fails.
    }
    await appendRunEvent({ consumptionId: params.runId, payload: { type: 'error', message } }).catch(() => {})
  } finally {
    if (sessionId) {
      setTimeout(() => {
        void killSandbox(sessionId!)
      }, 10 * 60 * 1000)
    }
  }
}
