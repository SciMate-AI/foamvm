import { NextRequest, NextResponse } from 'next/server'

import { verifyCliBearerToken } from '@/lib/cli-auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const verified = await verifyCliBearerToken(request.headers.get('authorization'))
  if (!verified || !verified.scopes.includes('artifacts:read')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const admin = createAdminSupabaseClient()
  const { data: run } = await admin
    .from('run_consumptions')
    .select('id')
    .eq('id', id)
    .eq('user_id', verified.userId)
    .single()

  if (!run) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data, error } = await admin
    .from('run_output_files')
    .select('id, filename, content_type, size_bytes, is_image, created_at')
    .eq('consumption_id', id)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    artifacts: (data ?? []).map((file) => ({
      id: file.id,
      filename: file.filename,
      content_type: file.content_type,
      size_bytes: file.size_bytes,
      is_image: file.is_image,
      url: `/api/files?id=${encodeURIComponent(file.id as string)}`,
      created_at: file.created_at,
    })),
  })
}
