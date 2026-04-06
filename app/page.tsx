'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type RunStatus = 'idle' | 'running' | 'done' | 'error'

interface LogEntry {
  id: number
  kind: 'status' | 'assistant' | 'tool_use' | 'tool_result' | 'log' | 'stderr' | 'error'
  text: string
  detail?: string
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function extractClaudeEvent(payload: Record<string, unknown>): { kind: LogEntry['kind']; text: string; detail?: string } | null {
  const type = payload.type as string
  if (type === 'assistant') {
    const msg = payload.message as { content?: { type: string; text?: string }[] } | undefined
    const content = msg?.content ?? []
    const texts = content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('')
    if (!texts) return null
    return { kind: 'assistant', text: texts }
  }
  if (type === 'tool_use') {
    const p = payload as { name?: string; input?: unknown }
    return {
      kind: 'tool_use',
      text: `[${p.name ?? 'tool'}]`,
      detail: typeof p.input === 'string' ? p.input : JSON.stringify(p.input, null, 2),
    }
  }
  if (type === 'tool_result') {
    const content = (payload as { content?: unknown }).content
    const text = typeof content === 'string' ? content : JSON.stringify(content)
    return { kind: 'tool_result', text: text.slice(0, 500) + (text.length > 500 ? '…' : '') }
  }
  if (type === 'result') {
    const result = (payload as { result?: string }).result ?? ''
    if (!result) return null
    return { kind: 'assistant', text: result }
  }
  return null
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LogLine({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = useState(false)

  const colors: Record<LogEntry['kind'], string> = {
    status:      'text-blue-400',
    assistant:   'text-green-300',
    tool_use:    'text-yellow-400',
    tool_result: 'text-gray-400',
    log:         'text-gray-500',
    stderr:      'text-orange-400',
    error:       'text-red-400',
  }
  const icons: Record<LogEntry['kind'], string> = {
    status:      '●',
    assistant:   '▸',
    tool_use:    '⚙',
    tool_result: '↳',
    log:         '·',
    stderr:      '!',
    error:       '✕',
  }

  return (
    <div className={`log-entry font-mono text-xs leading-relaxed ${colors[entry.kind]}`}>
      <span className="opacity-40 mr-2 select-none">{icons[entry.kind]}</span>
      <span className="whitespace-pre-wrap break-words">{entry.text}</span>
      {entry.detail && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            className="ml-2 text-gray-600 hover:text-gray-400 underline"
          >
            {expanded ? 'hide' : 'expand'}
          </button>
          {expanded && (
            <pre className="mt-1 ml-4 text-gray-500 bg-gray-900 p-2 rounded-md overflow-x-auto text-xs">
              {entry.detail}
            </pre>
          )}
        </>
      )}
    </div>
  )
}

function ImageCard({ img }: { img: ImageResult }) {
  const [zoomed, setZoomed] = useState(false)
  return (
    <>
      <div
        className="group relative rounded-lg overflow-hidden border border-gray-800 cursor-zoom-in bg-gray-900 hover:border-gray-600 transition-colors"
        onClick={() => setZoomed(true)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img.dataUrl} alt={img.name} className="w-full object-contain max-h-56" />
        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent px-3 py-2 translate-y-full group-hover:translate-y-0 transition-transform">
          <span className="text-xs text-gray-300 font-mono truncate block">{img.name}</span>
        </div>
      </div>
      {zoomed && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center cursor-zoom-out p-6"
          onClick={() => setZoomed(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img.dataUrl} alt={img.name} className="max-w-full max-h-full object-contain rounded-xl shadow-2xl" />
          <span className="absolute bottom-6 text-xs text-gray-500 font-mono">{img.name} · click to close</span>
        </div>
      )}
    </>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const EXAMPLE_PROMPTS = [
  'Run a 2D lid-driven cavity flow at Re=1000, generate a velocity magnitude contour plot',
  'Simulate flow over a backward-facing step, Re=100, and plot streamlines',
  'Create a simple pipe flow mesh with blockMesh and run icoFoam for Re=500',
]

export default function Home() {
  const [prompt, setPrompt]         = useState('')
  const [status, setStatus]         = useState<RunStatus>('idle')
  const [logs, setLogs]             = useState<LogEntry[]>([])
  const [images, setImages]         = useState<ImageResult[]>([])
  const [files, setFiles]           = useState<FileResult[]>([])
  const [sessionId, setSessionId]   = useState<string | null>(null)
  const logCounter                  = useRef(0)
  const logEndRef                   = useRef<HTMLDivElement>(null)
  const abortRef                    = useRef<AbortController | null>(null)

  const addLog = useCallback((kind: LogEntry['kind'], text: string, detail?: string) => {
    setLogs((prev) => [...prev, { id: logCounter.current++, kind, text, detail }])
  }, [])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const handleEvent = useCallback((event: Record<string, unknown>) => {
    const type = event.type as string
    switch (type) {
      case 'status':
        addLog('status', event.message as string)
        break
      case 'session':
        setSessionId(event.sessionId as string)
        break
      case 'claude': {
        const result = extractClaudeEvent(event.payload as Record<string, unknown>)
        if (result) addLog(result.kind, result.text, result.detail)
        break
      }
      case 'log':
        addLog('log', event.text as string)
        break
      case 'stderr':
        if ((event.text as string)?.trim()) addLog('stderr', event.text as string)
        break
      case 'image':
        setImages((prev) => [...prev, { name: event.name as string, dataUrl: event.dataUrl as string }])
        break
      case 'file':
        setFiles((prev) => [...prev, { name: event.name as string, url: event.url as string, size: event.size as number }])
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!prompt.trim() || status === 'running') return

    setStatus('running')
    setLogs([])
    setImages([])
    setFiles([])
    setSessionId(null)

    abortRef.current = new AbortController()

    try {
      const res = await fetch('/api/cfd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
        signal: abortRef.current.signal,
      })

      if (!res.ok || !res.body) throw new Error(`Server error: ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (value) buffer += decoder.decode(value, { stream: !done })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''
        for (const part of parts) {
          const dataLine = part.split('\n').find((l) => l.startsWith('data: '))
          if (!dataLine) continue
          try {
            handleEvent(JSON.parse(dataLine.slice(6)))
          } catch {
            addLog('log', dataLine.slice(6))
          }
        }
        if (done) break
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        addLog('error', (err as Error).message)
        setStatus('error')
      } else {
        setStatus('idle')
      }
    }
  }

  const handleStop = () => {
    abortRef.current?.abort()
  }

  const isRunning  = status === 'running'
  const hasResults = images.length > 0 || files.length > 0

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gray-950">
      {/* Header */}
      <header className="flex-none h-12 border-b border-gray-800/80 px-5 flex items-center gap-3 bg-gray-950/90 backdrop-blur">
        <div className="w-6 h-6 rounded bg-blue-600 flex items-center justify-center text-white font-bold text-xs select-none">S</div>
        <span className="font-semibold text-sm text-gray-100 tracking-tight">SciMate</span>
        <span className="text-gray-700 text-sm">/</span>
        <span className="text-gray-500 text-sm">CFD on Demand</span>
        <div className="flex-1" />
        {sessionId && (
          <span className="text-xs text-gray-700 font-mono hidden md:block">
            {sessionId.slice(0, 12)}…
          </span>
        )}
        {status === 'done'  && <span className="text-xs font-medium text-green-500 bg-green-500/10 px-2 py-0.5 rounded-full">Done</span>}
        {status === 'error' && <span className="text-xs font-medium text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full">Error</span>}
        {isRunning          && <span className="text-xs font-medium text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-blue-400 blink" />Running</span>}
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Left panel: input + logs ── */}
        <div className="flex flex-col border-r border-gray-800/80 overflow-hidden" style={{ width: '50%' }}>
          {/* Input */}
          <div className="flex-none p-4 border-b border-gray-800/50 space-y-2">
            <form onSubmit={handleSubmit} className="space-y-2">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe your CFD task in plain English…"
                rows={4}
                disabled={isRunning}
                className="w-full bg-gray-900 border border-gray-700/80 rounded-lg px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 resize-none focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600/30 disabled:opacity-50 font-mono leading-relaxed"
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit(e) }}
              />
              <div className="flex items-center gap-2">
                {isRunning ? (
                  <button type="button" onClick={handleStop}
                    className="px-3 py-1.5 text-xs rounded-md bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-colors">
                    Stop
                  </button>
                ) : (
                  <button type="submit" disabled={!prompt.trim()}
                    className="px-4 py-1.5 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium">
                    Run CFD
                  </button>
                )}
                <span className="text-xs text-gray-600">⌘ + Enter</span>
              </div>
            </form>

            {/* Example prompts */}
            {!isRunning && logs.length === 0 && (
              <div className="space-y-1 pt-1">
                <p className="text-xs text-gray-600">Examples:</p>
                {EXAMPLE_PROMPTS.map((ex) => (
                  <button key={ex} onClick={() => setPrompt(ex)}
                    className="block w-full text-left text-xs text-gray-500 hover:text-gray-300 truncate transition-colors py-0.5">
                    → {ex}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Logs */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-0.5">
            {logs.length === 0 && (
              <p className="text-gray-700 text-xs text-center mt-10 font-mono">
                logs will stream here
              </p>
            )}
            {logs.map((entry) => <LogLine key={entry.id} entry={entry} />)}
            <div ref={logEndRef} />
          </div>
        </div>

        {/* ── Right panel: results ── */}
        <div className="flex flex-col overflow-hidden" style={{ width: '50%' }}>
          <div className="flex-none px-5 py-2.5 border-b border-gray-800/50">
            <span className="text-xs text-gray-500 uppercase tracking-wider font-medium">
              Results
              {hasResults && <span className="ml-2 text-gray-700">· {images.length} image{images.length !== 1 ? 's' : ''}, {files.length} file{files.length !== 1 ? 's' : ''}</span>}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {!hasResults && !isRunning && (
              <div className="flex flex-col items-center justify-center h-full gap-3 opacity-30 select-none">
                <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                    d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M6.75 21h10.5A2.25 2.25 0 0019.5 18.75V6.75A2.25 2.25 0 0017.25 4.5H6.75A2.25 2.25 0 004.5 6.75v12A2.25 2.25 0 006.75 21zM16.5 8.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
                </svg>
                <p className="text-xs font-mono">images &amp; files appear here</p>
              </div>
            )}

            {isRunning && !hasResults && (
              <div className="flex items-center gap-2 text-xs text-gray-600 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 blink" />
                awaiting output…
              </div>
            )}

            {images.length > 0 && (
              <section className="mb-6">
                <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-3 font-medium">Visualizations</h3>
                <div className="grid grid-cols-2 gap-2">
                  {images.map((img) => <ImageCard key={img.name} img={img} />)}
                </div>
              </section>
            )}

            {files.length > 0 && (
              <section>
                <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-3 font-medium">Output Files</h3>
                <div className="space-y-1">
                  {files.map((f) => (
                    <a key={f.name} href={f.url} download={f.name}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-900 hover:bg-gray-800/80 border border-transparent hover:border-gray-700/50 transition-all group">
                      <svg className="w-4 h-4 text-gray-600 flex-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m.75 12l3 3m0 0l3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                      </svg>
                      <span className="text-xs text-gray-300 font-mono group-hover:text-white flex-1 truncate">{f.name}</span>
                      <span className="text-xs text-gray-600 flex-none">{humanSize(f.size)}</span>
                    </a>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
