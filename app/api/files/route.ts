import { NextRequest, NextResponse } from 'next/server'

import { getAuthenticatedUser } from '@/lib/auth'
import { getOutputBucketName } from '@/lib/env'
import { getAuthorizedOutputFile } from '@/lib/run-tokens'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const fileId = searchParams.get('id')

  if (!fileId) {
    return NextResponse.json({ error: 'Missing file id' }, { status: 400 })
  }

  const file = await getAuthorizedOutputFile({
    fileId,
    userId: user.id,
  })

  if (!file) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  const admin = createAdminSupabaseClient()
  const { data, error } = await admin.storage.from(getOutputBucketName()).download(file.storagePath)

  if (error || !data) {
    return NextResponse.json({ error: 'Unable to download file' }, { status: 500 })
  }

  return new NextResponse(Buffer.from(await data.arrayBuffer()), {
    headers: {
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Content-Length': String(file.sizeBytes),
    },
  })
}
