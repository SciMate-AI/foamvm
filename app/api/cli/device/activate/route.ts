import { NextRequest, NextResponse } from 'next/server'

import { getAuthenticatedUser, ensureProfileRecord } from '@/lib/auth'
import { approveCliDevice } from '@/lib/cli-auth'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { user_code: userCode } = await request.json()
  if (!userCode || typeof userCode !== 'string') {
    return NextResponse.json({ error: 'Missing user_code' }, { status: 400 })
  }

  try {
    await ensureProfileRecord(user)
    await approveCliDevice({ userCode, userId: user.id })
    return NextResponse.json({ status: 'approved' })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
