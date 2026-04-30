import { NextRequest, NextResponse } from 'next/server'

import { createCliDeviceCode } from '@/lib/cli-auth'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const origin = request.nextUrl.origin
  const created = await createCliDeviceCode({ origin })

  return NextResponse.json({
    user_code: created.userCode,
    device_code: created.deviceCode,
    verification_url: created.verificationUrl,
    expires_in: created.expiresIn,
    interval: 2,
  })
}
