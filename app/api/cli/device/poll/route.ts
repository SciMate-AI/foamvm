import { NextRequest, NextResponse } from 'next/server'

import { pollCliDevice } from '@/lib/cli-auth'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const { device_code: deviceCode } = await request.json()
  if (!deviceCode || typeof deviceCode !== 'string') {
    return NextResponse.json({ error: 'Missing device_code' }, { status: 400 })
  }

  const result = await pollCliDevice({ deviceCode })
  if (result.status === 'invalid') {
    return NextResponse.json({ error: 'Invalid device code' }, { status: 404 })
  }

  return NextResponse.json({
    status: result.status,
    access_token: result.accessToken,
    token_type: result.accessToken ? 'Bearer' : undefined,
  })
}
