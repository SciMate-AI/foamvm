import { NextRequest, NextResponse } from 'next/server'
import { getSessionFile } from '@/lib/sandbox'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const sessionId = searchParams.get('session')
  const filename = searchParams.get('file')

  if (!sessionId || !filename) {
    return NextResponse.json({ error: 'Missing session or file' }, { status: 400 })
  }

  const bytes = getSessionFile(sessionId, filename)
  if (!bytes) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  // Infer content type
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  const contentTypeMap: Record<string, string> = {
    txt: 'text/plain',
    log: 'text/plain',
    csv: 'text/csv',
    vtk: 'application/octet-stream',
    vtu: 'application/octet-stream',
    foam: 'application/octet-stream',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    svg: 'image/svg+xml',
  }

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': contentTypeMap[ext] || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(bytes.length),
    },
  })
}
