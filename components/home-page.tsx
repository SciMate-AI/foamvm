'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ViewerContext } from '@/lib/auth'

type RunStatus = 'idle' | 'running' | 'done' | 'error'

interface LogEntry {
  id: number
  kind: 'status' | 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'log' | 'stderr' | 'error'
  text: string
  detail?: string
  todos?: TodoItem[]
}

interface TodoItem {
  status: string
  content: string
  activeForm?: string
}

interface ImageResult {
  name: string
  dataUrl: string
}

interface FileResult {
  name: string
  url: string
  size: number
}

interface RunSummary {
  id: string
  status: 'starting' | 'running' | 'completed' | 'failed'
  sandboxSessionId: string | null
  commandPid: number | null
  promptExcerpt: string | null
  createdAt: string
  errorMessage: string | null
}

interface PersistedRunEvent {
  id: number
  payload: Record<string, unknown>
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function normalizeMarkdownText(text: string): string {
  const lines = text.replace(/\r/g, '').split('\n')
  const numberedLines = lines.filter((line) => line.trim()).filter((line) => /^\d+\t/.test(line))

  if (numberedLines.length > 0 && numberedLines.length >= Math.ceil(lines.filter((line) => line.trim()).length * 0.6)) {
    return lines.map((line) => line.replace(/^\d+\t/, '')).join('\n')
  }

  return text
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`)/g)

  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return (
        <code className="rounded bg-white/8 px-1 py-0.5 text-[0.95em] text-white" key={index}>
          {part.slice(1, -1)}
        </code>
      )
    }

    return <span key={index}>{part}</span>
  })
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function isTableSeparator(line: string): boolean {
  return /^\|?\s*[:\- ]+\|[:\-| ]+\|?\s*$/.test(line.trim())
}

function renderHeading(level: number, content: string, key: string) {
  const rendered = renderInlineMarkdown(content)

  if (level === 1) {
    return <h1 className="text-sm font-semibold text-white" key={key}>{rendered}</h1>
  }
  if (level === 2) {
    return <h2 className="text-sm font-semibold text-white" key={key}>{rendered}</h2>
  }
  if (level === 3) {
    return <h3 className="text-xs font-semibold text-slate-100" key={key}>{rendered}</h3>
  }
  if (level === 4) {
    return <h4 className="text-xs font-semibold text-slate-100" key={key}>{rendered}</h4>
  }
  if (level === 5) {
    return <h5 className="text-xs font-semibold text-slate-100" key={key}>{rendered}</h5>
  }
  return <h6 className="text-xs font-semibold text-slate-100" key={key}>{rendered}</h6>
}

function MarkdownText({ text }: { text: string }) {
  const normalized = normalizeMarkdownText(text)
  const lines = normalized.split('\n')
  const blocks: ReactNode[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    if (!line.trim()) {
      index += 1
      continue
    }

    if (line.startsWith('```')) {
      const codeLines: string[] = []
      const language = line.slice(3).trim()
      index += 1
      while (index < lines.length && !lines[index].startsWith('```')) {
        codeLines.push(lines[index])
        index += 1
      }
      if (index < lines.length && lines[index].startsWith('```')) {
        index += 1
      }

      blocks.push(
        <pre className="overflow-x-auto rounded-xl border border-white/5 bg-black/30 p-3 text-[11px] text-slate-200" key={`code-${blocks.length}`}>
          {language ? <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-white/35">{language}</div> : null}
          <code>{codeLines.join('\n')}</code>
        </pre>,
      )
      continue
    }

    if (/^#{1,6}\s+/.test(line)) {
      const level = Math.min((line.match(/^#+/)?.[0].length ?? 1), 6)
      const content = line.replace(/^#{1,6}\s+/, '')
      blocks.push(renderHeading(level, content, `heading-${blocks.length}`))
      index += 1
      continue
    }

    if (line.includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const header = splitTableRow(line)
      const rows: string[][] = []
      index += 2

      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]))
        index += 1
      }

      blocks.push(
        <div className="overflow-x-auto" key={`table-${blocks.length}`}>
          <table className="min-w-full border-collapse text-[11px] text-slate-200">
            <thead>
              <tr>
                {header.map((cell, cellIndex) => (
                  <th className="border border-white/10 bg-white/5 px-2 py-1 text-left font-semibold" key={cellIndex}>
                    {renderInlineMarkdown(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td className="border border-white/10 px-2 py-1 align-top" key={cellIndex}>
                      {renderInlineMarkdown(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      const ordered = /^\d+\.\s+/.test(line)
      const items: string[] = []

      while (index < lines.length) {
        const current = lines[index]
        if (ordered && /^\d+\.\s+/.test(current)) {
          items.push(current.replace(/^\d+\.\s+/, ''))
          index += 1
          continue
        }
        if (!ordered && /^[-*]\s+/.test(current)) {
          items.push(current.replace(/^[-*]\s+/, ''))
          index += 1
          continue
        }
        break
      }

      const ListTag = ordered ? 'ol' : 'ul'
      blocks.push(
        <ListTag className="ml-5 space-y-1 text-slate-200" key={`list-${blocks.length}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
          ))}
        </ListTag>,
      )
      continue
    }

    const paragraphLines: string[] = []
    while (index < lines.length && lines[index].trim() && !lines[index].startsWith('```') && !/^#{1,6}\s+/.test(lines[index])) {
      if (lines[index].includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
        break
      }
      if (/^[-*]\s+/.test(lines[index]) || /^\d+\.\s+/.test(lines[index])) {
        break
      }
      paragraphLines.push(lines[index])
      index += 1
    }

    blocks.push(
      <p className="whitespace-pre-wrap break-words text-slate-200" key={`paragraph-${blocks.length}`}>
        {paragraphLines.map((paragraphLine, paragraphIndex) => (
          <span key={paragraphIndex}>
            {renderInlineMarkdown(paragraphLine)}
            {paragraphIndex < paragraphLines.length - 1 ? <br /> : null}
          </span>
        ))}
      </p>,
    )
  }

  return <div className="space-y-2">{blocks}</div>
}

function extractTodos(input: unknown): TodoItem[] | null {
  if (!input || typeof input !== 'object' || !('todos' in input)) {
    return null
  }

  const rawTodos = Array.isArray((input as { todos?: unknown[] }).todos) ? (input as { todos: unknown[] }).todos : []
  const todos: TodoItem[] = []

  for (const todo of rawTodos) {
    if (!todo || typeof todo !== 'object') continue

    const status = typeof (todo as { status?: unknown }).status === 'string' ? (todo as { status: string }).status : 'pending'
    const content = typeof (todo as { content?: unknown }).content === 'string' ? (todo as { content: string }).content : 'Task'
    const activeForm = typeof (todo as { activeForm?: unknown }).activeForm === 'string'
      ? (todo as { activeForm: string }).activeForm
      : undefined

    todos.push({ status, content, activeForm })
  }

  return todos.length > 0 ? todos : null
}

function summarizeToolUse(name: string, input: unknown): { text: string; todos?: TodoItem[] } {
  if (name === 'TodoWrite' && input && typeof input === 'object' && 'todos' in input) {
    const todos = extractTodos(input)
    if (todos) {
      const inProgress = todos.find((todo) => todo.status === 'in_progress')
      return {
        text: inProgress?.activeForm || inProgress?.content || 'Updating task checklist',
        todos,
      }
    }
  }

  return { text: `[${name}]` }
}

function extractClaudeEvent(payload: Record<string, unknown>): { kind: LogEntry['kind']; text: string; detail?: string; todos?: TodoItem[] }[] {
  const entries: { kind: LogEntry['kind']; text: string; detail?: string; todos?: TodoItem[] }[] = []
  const type = payload.type as string

  if (type === 'user') {
    const msg = payload.message as {
      content?: { type: string; text?: string; content?: unknown; tool_use_id?: string }[]
    } | undefined
    const content = msg?.content ?? []
    for (const item of content) {
      if (item.type === 'text' && item.text) {
        entries.push({ kind: 'user', text: item.text })
      }
      if (item.type === 'tool_result') {
        const toolResultText =
          typeof item.content === 'string'
            ? item.content
            : item.content && typeof item.content === 'object' && 'file' in item.content &&
                typeof (item.content as { file?: { content?: unknown } }).file?.content === 'string'
              ? ((item.content as { file: { content: string } }).file.content)
              : null

        if (toolResultText) {
          entries.push({
            kind: 'user',
            text: toolResultText,
            detail: item.tool_use_id ? `tool_use_id: ${item.tool_use_id}` : undefined,
          })
        }
      }
    }
    return entries
  }

  if (type === 'assistant') {
    const msg = payload.message as {
      content?: { type: string; text?: string; name?: string; input?: unknown }[]
    } | undefined
    const content = msg?.content ?? []
    for (const item of content) {
      if (item.type === 'text' && item.text) {
        entries.push({ kind: 'assistant', text: item.text })
      }
      if (item.type === 'tool_use') {
        entries.push({
          kind: 'tool_use',
          ...summarizeToolUse(item.name ?? 'tool', item.input),
          detail: typeof item.input === 'string' ? item.input : JSON.stringify(item.input, null, 2),
        })
      }
    }
    return entries
  }
  if (type === 'tool_use') {
    const toolPayload = payload as { name?: string; input?: unknown }
    entries.push({
      kind: 'tool_use',
      ...summarizeToolUse(toolPayload.name ?? 'tool', toolPayload.input),
      detail: typeof toolPayload.input === 'string' ? toolPayload.input : JSON.stringify(toolPayload.input, null, 2),
    })
    return entries
  }
  if (type === 'tool_result') {
    const content = (payload as { content?: unknown }).content
    const text = typeof content === 'string' ? content : JSON.stringify(content)
    entries.push({
      kind: 'tool_result',
      text: text.slice(0, 500) + (text.length > 500 ? '...' : ''),
    })
    return entries
  }
  if (type === 'result') {
    const result = (payload as { result?: string }).result ?? ''
    if (result) {
      entries.push({ kind: 'assistant', text: result })
    }
    return entries
  }
  return entries
}

function LogLine({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = useState(false)

  const colors: Record<LogEntry['kind'], string> = {
    status: 'text-sky-300',
    user: 'text-cyan-200',
    assistant: 'text-emerald-300',
    tool_use: 'text-amber-300',
    tool_result: 'text-slate-400',
    log: 'text-slate-500',
    stderr: 'text-orange-300',
    error: 'text-rose-300',
  }

  return (
    <div className={`log-entry rounded-2xl border border-white/5 bg-white/[0.02] px-3 py-2 font-mono text-xs leading-relaxed ${colors[entry.kind]}`}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-[10px] uppercase tracking-[0.2em] text-white/30">{entry.kind}</span>
        <div className="min-w-0 flex-1">
          {entry.kind === 'assistant' || entry.kind === 'user' ? (
            <MarkdownText text={entry.text} />
          ) : (
            <span className="whitespace-pre-wrap break-words">{entry.text}</span>
          )}
        </div>
      </div>
      {entry.todos ? (
        <div className="mt-2 rounded-xl border border-white/5 bg-black/20 p-3 text-[11px] text-slate-200">
          <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-white/35">Checklist</div>
          <div className="space-y-1.5">
            {entry.todos.map((todo, index) => {
              const marker =
                todo.status === 'completed' ? '[x]' :
                todo.status === 'in_progress' ? '[~]' :
                '[ ]'

              return (
                <div className="flex gap-2" key={`${todo.content}-${index}`}>
                  <span className="text-white/45">{marker}</span>
                  <span className="whitespace-pre-wrap break-words">
                    {todo.activeForm || todo.content}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
      {entry.detail ? (
        <div className="mt-2">
          <button
            onClick={() => setExpanded((value) => !value)}
            className="text-[11px] text-white/40 underline transition hover:text-white/70"
            type="button"
          >
            {expanded ? 'Hide detail' : 'Expand detail'}
          </button>
          {expanded ? (
            <pre className="mt-2 overflow-x-auto rounded-xl border border-white/5 bg-black/30 p-3 text-[11px] text-slate-300">
              {entry.detail}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function ImageCard({ image }: { image: ImageResult }) {
  const [zoomed, setZoomed] = useState(false)

  return (
    <>
      <button
        className="group relative overflow-hidden rounded-3xl border border-white/10 bg-black/40 text-left transition hover:border-cyan-300/40"
        onClick={() => setZoomed(true)}
        type="button"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt={image.name} className="max-h-72 w-full object-contain bg-slate-950/70" src={image.dataUrl} />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950 to-transparent px-4 py-3 text-xs text-slate-200">
          {image.name}
        </div>
      </button>
      {zoomed ? (
        <button
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-slate-950/95 p-8"
          onClick={() => setZoomed(false)}
          type="button"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt={image.name} className="max-h-full max-w-full rounded-3xl object-contain shadow-2xl" src={image.dataUrl} />
        </button>
      ) : null}
    </>
  )
}

const EXAMPLE_PROMPTS = [
  '运行 2D lid-driven cavity，Re=1000，并生成速度云图 / Run a 2D lid-driven cavity at Re=1000 with velocity contours.',
  '模拟 backward-facing step，Re=100，并输出流线和压降 / Simulate a backward-facing step at Re=100 with streamlines and pressure drop.',
  '用 blockMesh 创建简单管流网格，运行 icoFoam，并导出关键结果文件 / Create a pipe-flow mesh with blockMesh, run icoFoam, and export result files.',
]

export function HomePage({ viewer }: { viewer: ViewerContext }) {
  const [prompt, setPrompt] = useState('')
  const [status, setStatus] = useState<RunStatus>('idle')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [images, setImages] = useState<ImageResult[]>([])
  const [files, setFiles] = useState<FileResult[]>([])
  const [runId, setRunId] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [remainingRuns, setRemainingRuns] = useState(viewer.availableRuns)
  const logCounter = useRef(0)
  const logEndRef = useRef<HTMLDivElement>(null)
  const streamAbortRef = useRef<AbortController | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentRunIdRef = useRef<string | null>(null)
  const lastEventIdRef = useRef(0)
  const statusRef = useRef<RunStatus>('idle')

  const addLog = useCallback((kind: LogEntry['kind'], text: string, detail?: string) => {
    setLogs((previous) => [...previous, { id: logCounter.current++, kind, text, detail }])
  }, [])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  useEffect(() => {
    currentRunIdRef.current = runId
  }, [runId])

  useEffect(() => {
    statusRef.current = status
  }, [status])

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
  }, [])

  const stopStreaming = useCallback(() => {
    streamAbortRef.current?.abort()
    streamAbortRef.current = null
    clearReconnectTimer()
  }, [clearReconnectTimer])

  useEffect(() => () => {
    stopStreaming()
  }, [stopStreaming])

  const resetRunView = useCallback(() => {
    setLogs([])
    setImages([])
    setFiles([])
    setSessionId(null)
    setRunId(null)
    currentRunIdRef.current = null
    lastEventIdRef.current = 0
    logCounter.current = 0
  }, [])

  const applyEvent = useCallback((event: Record<string, unknown>) => {
    const eventId = typeof event.eventId === 'number' ? event.eventId : null
    if (eventId != null) {
      if (eventId <= lastEventIdRef.current) {
        return
      }
      lastEventIdRef.current = eventId
    }

    const type = event.type as string
    switch (type) {
      case 'status':
        addLog('status', event.message as string)
        break
      case 'session':
        setSessionId(event.sessionId as string)
        break
      case 'credit':
        setRemainingRuns(Number(event.remainingRuns) || 0)
        break
      case 'claude': {
        const results = extractClaudeEvent(event.payload as Record<string, unknown>)
        for (const result of results) {
          addLog(result.kind, result.text, result.detail)
        }
        break
      }
      case 'log':
        addLog('log', event.text as string)
        break
      case 'stderr':
        if ((event.text as string)?.trim()) addLog('stderr', event.text as string)
        break
      case 'image':
        setImages((previous) => [...previous, { name: event.name as string, dataUrl: event.dataUrl as string }])
        break
      case 'file':
        setFiles((previous) => [...previous, { name: event.name as string, url: event.url as string, size: event.size as number }])
        break
      case 'error':
        addLog('error', event.message as string)
        setStatus('error')
        break
      case 'done':
        setStatus('done')
        break
    }
  }, [addLog])

  const syncRunState = useCallback((run: RunSummary) => {
    setRunId(run.id)
    currentRunIdRef.current = run.id
    setSessionId(run.sandboxSessionId)

    if (run.status === 'completed') {
      setStatus('done')
      return false
    }

    if (run.status === 'failed') {
      setStatus('error')
      return false
    }

    setStatus('running')
    return true
  }, [])

  const readErrorMessage = useCallback(async (response: Response): Promise<string> => {
    try {
      const payload = await response.json()
      if (typeof payload.error === 'string') {
        return payload.error
      }
    } catch {
      const text = await response.text().catch(() => '')
      if (text) return text
    }

    return `Request failed with status ${response.status}`
  }, [])

  const fetchRunSnapshot = useCallback(async (targetRunId: string): Promise<{ run: RunSummary; events: PersistedRunEvent[] }> => {
    const response = await fetch(`/api/cfd/${encodeURIComponent(targetRunId)}`)
    if (!response.ok) {
      throw new Error(await readErrorMessage(response))
    }

    return response.json()
  }, [readErrorMessage])

  const hydrateRunRef = useRef<(targetRunId: string, reset: boolean) => Promise<void>>(async () => {})
  const openStreamRef = useRef<(targetRunId: string) => Promise<void>>(async () => {})

  const scheduleReconnect = useCallback((targetRunId: string) => {
    clearReconnectTimer()
    reconnectTimerRef.current = setTimeout(() => {
      void hydrateRunRef.current(targetRunId, false).catch(() => {
        if (currentRunIdRef.current === targetRunId) {
          addLog('error', 'Unable to restore the running session.')
          setStatus('error')
        }
      })
    }, 1200)
  }, [addLog, clearReconnectTimer])

  hydrateRunRef.current = async (targetRunId: string, reset: boolean) => {
    stopStreaming()

    if (reset) {
      resetRunView()
      setStatus('running')
    }

    const snapshot = await fetchRunSnapshot(targetRunId)
    const shouldStream = syncRunState(snapshot.run)

    for (const event of snapshot.events) {
      applyEvent({
        ...event.payload,
        eventId: event.id,
      })
    }

    if (shouldStream && currentRunIdRef.current === targetRunId) {
      await openStreamRef.current(targetRunId)
    }
  }

  openStreamRef.current = async (targetRunId: string) => {
    stopStreaming()

    const controller = new AbortController()
    streamAbortRef.current = controller

    try {
      const response = await fetch(`/api/cfd/${encodeURIComponent(targetRunId)}/events?after=${lastEventIdRef.current}`, {
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        throw new Error(await readErrorMessage(response))
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (value) {
          buffer += decoder.decode(value, { stream: !done })
        }

        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''

        for (const part of parts) {
          const dataLine = part.split('\n').find((line) => line.startsWith('data: '))
          if (!dataLine) continue

          try {
            applyEvent(JSON.parse(dataLine.slice(6)))
          } catch {
            addLog('log', dataLine.slice(6))
          }
        }

        if (done) break
      }

      if (currentRunIdRef.current === targetRunId && statusRef.current !== 'done' && statusRef.current !== 'error') {
        scheduleReconnect(targetRunId)
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        return
      }

      if (currentRunIdRef.current === targetRunId) {
        scheduleReconnect(targetRunId)
      }
    }
  }

  useEffect(() => {
    if (!viewer.user) {
      resetRunView()
      setStatus('idle')
      return
    }

    let cancelled = false

    const restoreActiveRun = async () => {
      try {
        const response = await fetch('/api/cfd')
        if (!response.ok) {
          throw new Error(await readErrorMessage(response))
        }

        const payload = await response.json() as { run: RunSummary | null }
        if (!payload.run || cancelled) {
          return
        }

        await hydrateRunRef.current(payload.run.id, true)
      } catch {
        // Ignore restore failures and keep the page interactive.
      }
    }

    void restoreActiveRun()

    return () => {
      cancelled = true
      stopStreaming()
    }
  }, [readErrorMessage, resetRunView, stopStreaming, viewer.user])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!prompt.trim() || status === 'running' || !viewer.user || remainingRuns <= 0) {
      return
    }

    stopStreaming()
    resetRunView()
    setStatus('running')

    try {
      const response = await fetch('/api/cfd', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt }),
      })

      if (!response.ok) {
        throw new Error(await readErrorMessage(response))
      }

      const payload = await response.json() as {
        runId: string
        remainingRuns: number
      }

      setRemainingRuns(payload.remainingRuns)
      await hydrateRunRef.current(payload.runId, false)
    } catch (error) {
      currentRunIdRef.current = null
      setRunId(null)
      addLog('error', (error as Error).message)
      setStatus('error')
    }
  }

  const handleStop = async () => {
    if (!runId) {
      return
    }

    try {
      addLog('status', 'Stopping run...')
      const response = await fetch(`/api/cfd/${encodeURIComponent(runId)}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error(await readErrorMessage(response))
      }
    } catch (error) {
      addLog('error', (error as Error).message)
    }
  }

  const isRunning = status === 'running'
  const hasResults = images.length > 0 || files.length > 0
  const canRun = Boolean(viewer.user) && remainingRuns > 0 && !isRunning

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(251,191,36,0.12),_transparent_22%),linear-gradient(180deg,_#020617_0%,_#0f172a_44%,_#020617_100%)] text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 pb-8 pt-6 sm:px-6 lg:px-8">
        <header className="mb-6 rounded-[28px] border border-white/10 bg-white/[0.03] px-5 py-4 shadow-2xl shadow-cyan-950/20 backdrop-blur">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-300 text-slate-950 shadow-lg shadow-cyan-500/20">
              <span className="text-sm font-semibold tracking-[0.22em]">OS</span>
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.32em] text-cyan-200/70">PhysicsOS Cloud / 物理仿真云</div>
              <h1 className="text-2xl font-semibold tracking-tight text-white">Unified Simulation Runner Platform</h1>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
              {viewer.user ? (
                <>
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-emerald-100">
                    {viewer.user.email}
                  </span>
                  <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-cyan-50">
                    {remainingRuns} 次运行额度 / runs ready
                  </span>
                  <Link className="rounded-full border border-white/10 px-3 py-1 text-slate-200 transition hover:border-white/30 hover:text-white" href="/redeem">
                    兑换邀请码 / Redeem
                  </Link>
                  <Link className="rounded-full border border-white/10 px-3 py-1 text-slate-200 transition hover:border-white/30 hover:text-white" href="/account">
                    账号 / Account
                  </Link>
                  {viewer.isAdmin ? (
                    <Link className="rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-amber-100 transition hover:border-amber-200/50" href="/admin/tokens">
                      管理 / Admin
                    </Link>
                  ) : null}
                </>
              ) : (
                <>
                  <span className="rounded-full border border-white/10 px-3 py-1 text-slate-300">
                    可浏览，运行需邀请码 / Browse first, run by invite
                  </span>
                  <Link className="rounded-full bg-cyan-300 px-4 py-1.5 font-medium text-slate-950 transition hover:bg-cyan-200" href="/auth/login">
                    登录 / Sign in
                  </Link>
                </>
              )}
            </div>
          </div>
        </header>

        <section className="mb-6 grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="rounded-[30px] border border-white/10 bg-white/[0.03] p-6 backdrop-blur">
            <div className="mb-5 max-w-3xl">
              <p className="text-sm uppercase tracking-[0.32em] text-cyan-200/70">Invite-gated physics compute / 邀请制物理计算</p>
              <h2 className="mt-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                PhysicsOS Cloud turns heavy solvers into controlled web and CLI services.
              </h2>
              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
                把 OpenFOAM/E2B、后续 SU2/Slurm/RunPod 等求解器放在云端统一管控；网页和 PhysicsOS CLI 共享账号、邀请码、额度和运行记录。
                CFD/OpenFOAM 是当前第一个可运行板块，更多物理后端会按相同权限模型接入。
              </p>
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-slate-200">
                一个邀请码 = 一次真实运行 / One token = one run
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-slate-200">
                邮箱验证码登录 / Email code login
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-slate-200">
                CLI 设备码授权 / CLI device-code auth
              </div>
            </div>
          </div>
          <div className="rounded-[30px] border border-cyan-300/10 bg-slate-950/40 p-6">
            <div className="text-xs uppercase tracking-[0.32em] text-cyan-200/70">Access state / 权限状态</div>
            {viewer.user ? (
              <div className="mt-4 space-y-3 text-sm text-slate-200">
                <p>你已登录，可以继续兑换邀请码增加运行额度。You are signed in and can redeem more run credits.</p>
                <p className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  剩余运行额度 / Remaining credits: <span className="font-semibold text-white">{remainingRuns}</span>
                </p>
                <p className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  已消耗运行 / Consumed runs: <span className="font-semibold text-white">{viewer.consumedRuns}</span>
                </p>
              </div>
            ) : (
              <div className="mt-4 space-y-3 text-sm text-slate-300">
                <p>未登录时可以浏览平台和样例，但不能启动沙箱。Without login, you can browse but cannot start sandbox execution.</p>
                <p>登录后仍需兑换至少一个邀请码，才能解锁真实求解器运行。A redeemed token is required before real solver runs.</p>
              </div>
            )}
          </div>
        </section>

        <section className="mb-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-[28px] border border-cyan-300/15 bg-cyan-300/[0.04] p-5">
            <div className="text-xs uppercase tracking-[0.28em] text-cyan-200/70">App 01 / 已上线</div>
            <h3 className="mt-2 text-xl font-semibold text-white">CFD / OpenFOAM</h3>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              自然语言 CFD、OpenFOAM 沙箱、日志流和结果文件下载。Natural-language CFD with OpenFOAM sandbox execution.
            </p>
          </div>
          <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
            <div className="text-xs uppercase tracking-[0.28em] text-slate-400">App 02 / 规划中</div>
            <h3 className="mt-2 text-xl font-semibold text-white">PhysicsOS CLI Runner</h3>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              CLI 通过设备码登录，提交结构化 solver manifest。Device-code CLI login and structured solver job submission.
            </p>
          </div>
          <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
            <div className="text-xs uppercase tracking-[0.28em] text-slate-400">App 03 / 规划中</div>
            <h3 className="mt-2 text-xl font-semibold text-white">TAPS / Surrogate Validation</h3>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              未来用于 TAPS、神经算子和 full solver 交叉验证。Future validation hub for TAPS, neural operators, and full solvers.
            </p>
          </div>
        </section>

        <div className="grid flex-1 gap-6 lg:grid-cols-2">
          <section className="flex min-h-[640px] flex-col overflow-hidden rounded-[30px] border border-white/10 bg-white/[0.03] backdrop-blur">
            <div className="border-b border-white/10 px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.32em] text-slate-400">CFD/OpenFOAM app / 当前板块</div>
                  <h3 className="mt-1 text-lg font-medium text-white">Execution console / 执行控制台</h3>
                </div>
                {sessionId ? (
                  <div className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">
                    Session {sessionId.slice(0, 12)}...
                  </div>
                ) : null}
              </div>
            </div>

            <div className="border-b border-white/10 px-5 py-5">
              <form className="space-y-4" onSubmit={handleSubmit}>
                <textarea
                  className="h-36 w-full resize-none rounded-[24px] border border-white/10 bg-slate-950/70 px-4 py-4 font-mono text-sm text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-cyan-300/60"
                  disabled={isRunning}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="用中文或英文描述 CFD 任务 / Describe your CFD task in Chinese or English..."
                  rows={5}
                  value={prompt}
                />

                <div className="flex flex-wrap items-center gap-3">
                  {isRunning ? (
                    <button
                      className="rounded-full border border-rose-300/30 bg-rose-300/10 px-4 py-2 text-sm font-medium text-rose-100 transition hover:border-rose-200/50"
                      onClick={handleStop}
                      type="button"
                    >
                      停止当前运行 / Stop run
                    </button>
                  ) : viewer.user ? (
                    canRun ? (
                      <button className="rounded-full bg-cyan-300 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200" type="submit">
                        运行 CFD / Run CFD
                      </button>
                    ) : (
                      <Link className="rounded-full bg-amber-300 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-200" href="/redeem">
                        先兑换邀请码 / Redeem first
                      </Link>
                    )
                  ) : (
                    <Link className="rounded-full bg-cyan-300 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200" href="/auth/login">
                      登录后运行 / Sign in to run
                    </Link>
                  )}
                  <span className="text-xs uppercase tracking-[0.24em] text-slate-500">Ctrl/Cmd + Enter</span>
                </div>
              </form>

              {!isRunning && logs.length === 0 ? (
                <div className="mt-4 space-y-2">
                  <div className="text-xs uppercase tracking-[0.28em] text-slate-500">样例提示 / Example prompts</div>
                  {EXAMPLE_PROMPTS.map((example) => (
                    <button
                      className="block w-full rounded-2xl border border-white/5 bg-black/20 px-4 py-3 text-left text-sm text-slate-300 transition hover:border-white/20 hover:text-white"
                      key={example}
                      onClick={() => setPrompt(example)}
                      type="button"
                    >
                      {example}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto px-5 py-5">
              {logs.length === 0 ? (
                <div className="flex h-full items-center justify-center rounded-[24px] border border-dashed border-white/10 bg-black/10 px-6 text-center text-sm text-slate-500">
                  运行日志、工具调用、stderr 和 agent 更新会在这里实时显示。Runtime logs, tool traces, stderr, and agent updates stream here.
                </div>
              ) : null}
              {logs.map((entry) => (
                <LogLine entry={entry} key={entry.id} />
              ))}
              <div ref={logEndRef} />
            </div>
          </section>

          <section className="flex min-h-[640px] flex-col overflow-hidden rounded-[30px] border border-white/10 bg-white/[0.03] backdrop-blur">
            <div className="border-b border-white/10 px-5 py-4">
              <div className="text-xs uppercase tracking-[0.32em] text-slate-400">Output / 输出</div>
              <h3 className="mt-1 text-lg font-medium text-white">Results and downloadable artifacts / 结果与文件</h3>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5">
              {!hasResults && !isRunning ? (
                <div className="flex h-full items-center justify-center rounded-[24px] border border-dashed border-white/10 bg-black/10 px-6 text-center text-sm text-slate-500">
                  成功运行后，图片和生成文件会出现在这里。Result images and generated files appear here after a successful run.
                </div>
              ) : null}

              {isRunning && !hasResults ? (
                <div className="rounded-3xl border border-cyan-300/10 bg-cyan-300/5 px-4 py-3 text-sm text-cyan-50">
                  已消耗一次运行额度，正在等待求解器输出和结果文件。Run token consumed; waiting for solver output and artifacts...
                </div>
              ) : null}

              {images.length > 0 ? (
                <section className="mb-6">
                  <div className="mb-3 text-xs uppercase tracking-[0.32em] text-slate-400">可视化 / Visualizations</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {images.map((image) => (
                      <ImageCard image={image} key={image.name} />
                    ))}
                  </div>
                </section>
              ) : null}

              {files.length > 0 ? (
                <section>
                  <div className="mb-3 text-xs uppercase tracking-[0.32em] text-slate-400">文件 / Files</div>
                  <div className="space-y-2">
                    {files.map((file) => (
                      <a
                        className="flex items-center gap-3 rounded-3xl border border-white/8 bg-black/20 px-4 py-3 transition hover:border-cyan-300/30 hover:bg-black/30"
                        download={file.name}
                        href={file.url}
                        key={file.name}
                      >
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/5 text-xs uppercase tracking-[0.28em] text-slate-300">
                          file
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-white">{file.name}</div>
                          <div className="text-xs text-slate-500">{humanSize(file.size)}</div>
                        </div>
                      </a>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
