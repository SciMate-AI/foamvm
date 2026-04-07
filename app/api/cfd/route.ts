import { CommandExitError } from 'e2b'
import type { Sandbox } from 'e2b'
import { NextRequest, NextResponse } from 'next/server'

import { getAuthenticatedUser } from '@/lib/auth'
import { collectOutputFiles, createCFDSandbox, killSandbox } from '@/lib/sandbox'
import { consumeRunTokenForUser, toDataUrl, updateRunConsumption, uploadRunOutputs } from '@/lib/run-tokens'

export const runtime = 'nodejs'
export const maxDuration = 800

async function runWithKeepalive(
  sandbox: Sandbox,
  cmd: string,
  opts: {
    cwd?: string
    envs?: Record<string, string>
  },
  onStdout: (data: string) => void,
  onStderr: (data: string) => void,
): Promise<void> {
  const keepaliveMs = 4 * 60 * 1000
  const reconnectDelayMs = 2000
  const maxReconnect = 8

  const handle = await sandbox.commands.run(cmd, {
    ...opts,
    background: true,
    timeoutMs: 0,
    onStdout,
    onStderr,
  } as Parameters<typeof sandbox.commands.run>[1] & { background: true })

  const pid = handle.pid
  const keepalive = setInterval(async () => {
    try {
      await sandbox.setTimeout(30 * 60 * 1000)
    } catch {
      // Ignore keepalive failures.
    }
  }, keepaliveMs)

  try {
    let currentHandle = handle
    let attempts = 0

    while (true) {
      try {
        await currentHandle.wait()
        return
      } catch (error) {
        if (!(error instanceof CommandExitError)) {
          throw error
        }

        const isConnectionDrop =
          error.message?.includes('terminated') ||
          error.message?.includes('disconnect') ||
          error.message?.includes('unknown')

        if (!isConnectionDrop || attempts >= maxReconnect) {
          if (error.stderr?.trim()) onStderr(error.stderr.slice(-500))
          if (!isConnectionDrop) throw error
          return
        }

        attempts += 1
        onStderr(`[reconnect attempt ${attempts}/${maxReconnect}]`)
        await new Promise((resolve) => setTimeout(resolve, reconnectDelayMs))
        currentHandle = await sandbox.commands.connect(pid, { onStdout, onStderr, timeoutMs: 0 })
      }
    }
  } finally {
    clearInterval(keepalive)
  }
}

function buildPromptExcerpt(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, ' ').trim()
  return cleaned.slice(0, 280)
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser()
  if (!user) {
    return NextResponse.json({ error: 'You must sign in before running CFD jobs.' }, { status: 401 })
  }

  const { prompt } = await request.json()
  if (!prompt?.trim()) {
    return NextResponse.json({ error: 'Missing prompt' }, { status: 400 })
  }

  const consumeResult = await consumeRunTokenForUser({
    userId: user.id,
    promptExcerpt: buildPromptExcerpt(prompt),
  })

  if (!consumeResult.success || !consumeResult.consumptionId) {
    return NextResponse.json({ error: consumeResult.message }, { status: 403 })
  }

  const consumptionId = consumeResult.consumptionId

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          // Ignore enqueue errors after the stream closes.
        }
      }

      let sessionId = ''

      try {
        send({ type: 'credit', remainingRuns: consumeResult.remainingRuns })
        send({ type: 'status', message: 'Creating sandbox...' })

        const { sandbox, sessionId: createdSessionId } = await createCFDSandbox()
        sessionId = createdSessionId

        await updateRunConsumption({
          consumptionId,
          status: 'running',
          sandboxSessionId: sessionId,
        })

        send({ type: 'session', sessionId })
        send({ type: 'status', message: 'Verifying sandbox environment...' })

        const check = await sandbox.commands.run('which claude && claude --version && node --version', {
          timeoutMs: 30000,
        })
        send({ type: 'log', text: `[env] ${check.stdout.trim()}` })

        const skills = await sandbox.commands.run(
          'ls /workspace/.claude/skills/hpc-openfoam/SKILL.md 2>/dev/null && echo ok || echo missing',
          { timeoutMs: 10000 },
        )
        send({ type: 'log', text: `[skills] ${skills.stdout.trim()}` })
        send({ type: 'status', message: 'Launching Claude Code...' })

        const escapedPrompt = prompt.replace(/'/g, `'"'"'`)
        const claudeCmd = `claude -p '${escapedPrompt}' --output-format stream-json --verbose --dangerously-skip-permissions`

        await runWithKeepalive(
          sandbox,
          claudeCmd,
          {
            cwd: '/workspace',
            envs: {
              ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
              ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || '',
            },
          },
          (data) => {
            for (const line of data.split('\n')) {
              const trimmed = line.trim()
              if (!trimmed) continue
              try {
                send({ type: 'claude', payload: JSON.parse(trimmed) })
              } catch {
                send({ type: 'log', text: trimmed })
              }
            }
          },
          (data) => {
            if (data.trim()) send({ type: 'stderr', text: data.trim() })
          },
        )

        send({ type: 'status', message: 'Collecting output files...' })
        const outputFiles = await collectOutputFiles(sandbox)
        const uploadedFiles = await uploadRunOutputs({
          userId: user.id,
          consumptionId,
          files: outputFiles,
        })

        for (const file of outputFiles) {
          const uploaded = uploadedFiles.get(file.name)
          if (!uploaded) continue

          if (file.isImage) {
            const dataUrl = toDataUrl(file)
            if (dataUrl) {
              send({
                type: 'image',
                name: file.name,
                dataUrl,
              })
            }
          }

          send({
            type: 'file',
            name: file.name,
            url: uploaded.url,
            size: file.size,
          })
        }

        await updateRunConsumption({
          consumptionId,
          status: 'completed',
          sandboxSessionId: sessionId,
        })

        send({ type: 'done', sessionId })
      } catch (error) {
        await updateRunConsumption({
          consumptionId,
          status: 'failed',
          sandboxSessionId: sessionId || null,
          errorMessage: error instanceof Error ? error.message : String(error),
        }).catch(() => {})

        send({ type: 'error', message: error instanceof Error ? error.message : String(error) })
      } finally {
        if (sessionId) {
          setTimeout(() => {
            void killSandbox(sessionId)
          }, 10 * 60 * 1000)
        }
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
