import { Sandbox, FileType, CommandExitError } from 'e2b'
import { CLAUDE_MD } from './claude-md'

const HPC_SKILLS_REPO = 'https://github.com/SciMate-AI/HPC-Skills'

/** Run a command and throw with full stderr on failure */
async function run(sandbox: Sandbox, cmd: string, timeoutMs = 60000): Promise<string> {
  try {
    const result = await sandbox.commands.run(cmd, { timeoutMs })
    return result.stdout
  } catch (err) {
    if (err instanceof CommandExitError) {
      throw new Error(
        `Command failed (exit ${err.exitCode}): ${cmd.slice(0, 80)}\n` +
        `stdout: ${err.stdout?.slice(-500) || '(empty)'}\n` +
        `stderr: ${err.stderr?.slice(-500) || '(empty)'}`
      )
    }
    throw err
  }
}


const activeSandboxes = new Map<string, Sandbox>()
const sessionFiles    = new Map<string, Map<string, Uint8Array>>()

// ─── Sandbox lifecycle ────────────────────────────────────────────────────────

export async function createCFDSandbox(): Promise<{ sandbox: Sandbox; sessionId: string }> {
  const templateId = process.env.E2B_TEMPLATE_ID || 'base'

  const sandbox = await Sandbox.create(templateId, {
    apiKey: process.env.E2B_API_KEY,
    timeoutMs: 30 * 60 * 1000,
    envs: {
      ANTHROPIC_API_KEY:  process.env.ANTHROPIC_API_KEY  || '',
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || '',
    },
  })

  const sessionId = sandbox.sandboxId
  activeSandboxes.set(sessionId, sandbox)

  await run(sandbox, 'mkdir -p /workspace/output /workspace/.claude/skills', 10000)
  await sandbox.files.write('/workspace/CLAUDE.md', CLAUDE_MD)
  await run(sandbox, `git clone --depth 1 ${HPC_SKILLS_REPO} /tmp/hpc-skills`, 60000)
  await run(sandbox, 'cp -r /tmp/hpc-skills/skills /workspace/.claude/', 10000)

  return { sandbox, sessionId }
}

export async function killSandbox(sessionId: string) {
  const sandbox = activeSandboxes.get(sessionId)
  if (sandbox) {
    try { await sandbox.kill() } catch { /* ignore */ }
    activeSandboxes.delete(sessionId)
  }
}

// ─── Output file collection ───────────────────────────────────────────────────

export async function collectOutputFiles(
  sandbox: Sandbox,
  sessionId: string
): Promise<{ name: string; isImage: boolean; size: number }[]> {
  const files: { name: string; isImage: boolean; size: number }[] = []
  const store = new Map<string, Uint8Array>()

  try {
    const entries = await sandbox.files.list('/workspace/output')
    for (const entry of entries) {
      if (entry.type !== FileType.FILE) continue
      try {
        const bytes = await sandbox.files.read(`/workspace/output/${entry.name}`, { format: 'bytes' })
        store.set(entry.name, bytes)
        const isImage = /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(entry.name)
        files.push({ name: entry.name, isImage, size: bytes.length })
      } catch { /* skip unreadable */ }
    }
  } catch { /* output dir might not exist */ }

  sessionFiles.set(sessionId, store)
  return files
}

// ─── File access ──────────────────────────────────────────────────────────────

export function getSessionFile(sessionId: string, filename: string): Uint8Array | undefined {
  return sessionFiles.get(sessionId)?.get(filename)
}

export function getImageAsBase64(sessionId: string, filename: string): string | undefined {
  const bytes = getSessionFile(sessionId, filename)
  if (!bytes) return undefined
  const base64 = Buffer.from(bytes).toString('base64')
  const ext     = filename.split('.').pop()?.toLowerCase() || 'png'
  const mime    = ext === 'svg' ? 'image/svg+xml' : `image/${ext}`
  return `data:${mime};base64,${base64}`
}

export function cleanupSession(sessionId: string) {
  sessionFiles.delete(sessionId)
  activeSandboxes.delete(sessionId)
}
