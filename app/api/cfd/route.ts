import { NextRequest } from 'next/server'
import { CommandExitError } from 'e2b'
import { createCFDSandbox, collectOutputFiles, getImageAsBase64, killSandbox } from '@/lib/sandbox'
import type { Sandbox } from 'e2b'

export const maxDuration = 1800

// ─── Keepalive + reconnect wrapper ────────────────────────────────────────────
// Runs a long command with:
//  • sandbox.setTimeout() every 4 min to prevent sandbox expiry
//  • auto-reconnect on connection drop (e2b "terminated" / disconnect errors)

async function runWithKeepalive(
  sandbox: Sandbox,
  cmd: string,
  opts: {
    cwd?: string
    envs?: Record<string, string>
  },
  onStdout: (data: string) => void,
  onStderr:  (data: string) => void,
): Promise<void> {
  const KEEPALIVE_MS  = 4 * 60 * 1000   // refresh sandbox every 4 min
  const MAX_RECONNECT = 8                // max reconnect attempts
  const RECONNECT_DELAY_MS = 2000

  // Start command in background — returns handle immediately with pid
  const handle = await sandbox.commands.run(cmd, {
    ...opts,
    background: true,
    timeoutMs: 0,   // disable SDK-level timeout; sandbox lifetime controls max duration
    onStdout,
    onStderr,
  } as Parameters<typeof sandbox.commands.run>[1] & { background: true })

  const pid = handle.pid

  // Keepalive: periodically extend sandbox lifetime
  const keepalive = setInterval(async () => {
    try { await sandbox.setTimeout(30 * 60 * 1000) } catch { /* ignore */ }
  }, KEEPALIVE_MS)

  try {
    let currentHandle = handle
    let attempts = 0

    while (true) {
      try {
        await currentHandle.wait()
        return  // finished normally
      } catch (err) {
        if (!(err instanceof CommandExitError)) throw err

        const isConnDrop =
          err.message?.includes('terminated') ||
          err.message?.includes('disconnect') ||
          err.message?.includes('unknown')

        if (!isConnDrop || attempts >= MAX_RECONNECT) {
          // Real exit or too many retries
          if (err.stderr?.trim()) onStderr(err.stderr.slice(-500))
          if (!isConnDrop) throw err
          return  // connection kept dropping — return with whatever output we got
        }

        attempts++
        onStderr(`[reconnect attempt ${attempts}/${MAX_RECONNECT}]`)
        await new Promise(r => setTimeout(r, RECONNECT_DELAY_MS))

        // Reconnect to the same running process by PID
        currentHandle = await sandbox.commands.connect(pid, { onStdout, onStderr, timeoutMs: 0 })
      }
    }
  } finally {
    clearInterval(keepalive)
  }
}

// ─── API route ─────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const { prompt } = await request.json()

  if (!prompt?.trim()) {
    return new Response('Missing prompt', { status: 400 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch (_) {}
      }

      let sessionId = ''

      try {
        send({ type: 'status', message: 'Creating sandbox...' })

        const { sandbox, sessionId: sid } = await createCFDSandbox()
        sessionId = sid
        send({ type: 'session', sessionId })

        // Verify environment
        send({ type: 'status', message: 'Verifying sandbox environment...' })
        const check = await sandbox.commands.run(
          'which claude && claude --version && node --version',
          { timeoutMs: 30000 }
        )
        send({ type: 'log', text: `[env] ${check.stdout.trim()}` })

        // Verify skills
        const skills = await sandbox.commands.run(
          'ls /workspace/.claude/skills/hpc-openfoam/SKILL.md 2>/dev/null && echo ok || echo missing',
          { timeoutMs: 10000 }
        )
        send({ type: 'log', text: `[skills] ${skills.stdout.trim()}` })

        // Launch Claude Code with keepalive + reconnect
        send({ type: 'status', message: 'Launching Claude Code...' })

        const escapedPrompt = prompt.replace(/'/g, `'"'"'`)
        const claudeCmd = `claude -p '${escapedPrompt}' --output-format stream-json --verbose --dangerously-skip-permissions`

        await runWithKeepalive(
          sandbox,
          claudeCmd,
          {
            cwd: '/workspace',
            envs: {
              ANTHROPIC_API_KEY:  process.env.ANTHROPIC_API_KEY  || '',
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

        // Collect output files
        send({ type: 'status', message: 'Collecting output files...' })
        const files = await collectOutputFiles(sandbox, sessionId)

        for (const f of files) {
          if (f.isImage) {
            const dataUrl = getImageAsBase64(sessionId, f.name)
            if (dataUrl) send({ type: 'image', name: f.name, dataUrl })
          } else {
            send({
              type: 'file',
              name: f.name,
              url: `/api/files?session=${sessionId}&file=${encodeURIComponent(f.name)}`,
              size: f.size,
            })
          }
        }

        send({ type: 'done', sessionId })

      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : String(err) })
      } finally {
        if (sessionId) setTimeout(() => killSandbox(sessionId), 10 * 60 * 1000)
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
