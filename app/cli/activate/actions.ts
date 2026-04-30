'use server'

import { redirect } from 'next/navigation'

import { approveCliDevice } from '@/lib/cli-auth'
import { ensureProfileRecord, requireAuthenticatedUser } from '@/lib/auth'

export async function approveCliDeviceAction(formData: FormData) {
  const userCode = String(formData.get('user_code') || '').trim().toUpperCase()
  const user = await requireAuthenticatedUser(`/cli/activate?user_code=${encodeURIComponent(userCode)}`)
  await ensureProfileRecord(user)
  await approveCliDevice({ userCode, userId: user.id })
  redirect('/account?cli=approved')
}
