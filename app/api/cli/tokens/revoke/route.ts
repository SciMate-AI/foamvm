import { NextRequest, NextResponse } from 'next/server'

import { hashCliSecret, verifyCliBearerToken } from '@/lib/cli-auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const verified = await verifyCliBearerToken(request.headers.get('authorization'))
  if (!verified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminSupabaseClient()
  const { error } = await admin
    .from('cli_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', verified.userId)
    .eq('token_hash', hashCliSecret(token))

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ revoked: true })
}
