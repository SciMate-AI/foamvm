import { NextRequest, NextResponse } from 'next/server'

import { verifyCliBearerToken } from '@/lib/cli-auth'
import { listUserRunEvents } from '@/lib/runs'

export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const verified = await verifyCliBearerToken(request.headers.get('authorization'))
  if (!verified || !verified.scopes.includes('runner:read')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const after = request.nextUrl.searchParams.get('after')
  const { id } = await params
  const events = await listUserRunEvents({
    consumptionId: id,
    userId: verified.userId,
    afterId: after ? Number(after) : undefined,
    limit: 200,
  })

  return NextResponse.json({ events })
}
