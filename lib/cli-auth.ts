import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CLI_TOKEN_PREFIX = 'psos_cli_'

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function randomAlphabet(length: number): string {
  const bytes = randomBytes(length)
  let output = ''
  for (let i = 0; i < length; i += 1) {
    output += USER_CODE_ALPHABET[bytes[i] % USER_CODE_ALPHABET.length]
  }
  return output
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function hashCliSecret(secret: string): string {
  return sha256(secret.trim())
}

export function generateUserCode(): string {
  return `${randomAlphabet(4)}-${randomAlphabet(4)}`
}

export function generateDeviceCode(): string {
  return randomBytes(32).toString('base64url')
}

export function generateCliToken(): string {
  return `${CLI_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
}

export async function createCliDeviceCode(params: {
  origin: string
}): Promise<{
  userCode: string
  deviceCode: string
  verificationUrl: string
  expiresIn: number
}> {
  const admin = createAdminSupabaseClient()
  const deviceCode = generateDeviceCode()
  const userCode = generateUserCode()
  const expiresIn = 10 * 60
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()

  const { error } = await admin.from('cli_device_codes').insert({
    user_code: userCode,
    device_code_hash: hashCliSecret(deviceCode),
    status: 'pending',
    expires_at: expiresAt,
  })

  if (error) {
    throw new Error(`Failed to create CLI device code: ${error.message}`)
  }

  return {
    userCode,
    deviceCode,
    verificationUrl: `${params.origin}/cli/activate?user_code=${encodeURIComponent(userCode)}`,
    expiresIn,
  }
}

export async function approveCliDevice(params: {
  userCode: string
  userId: string
}): Promise<void> {
  const admin = createAdminSupabaseClient()
  const { data, error } = await admin
    .from('cli_device_codes')
    .select('id, status, expires_at')
    .eq('user_code', params.userCode.trim().toUpperCase())
    .single()

  if (error || !data) {
    throw new Error('Invalid device code.')
  }

  if (data.status !== 'pending') {
    throw new Error('Device code is not pending.')
  }

  if (new Date(data.expires_at as string).getTime() < Date.now()) {
    await admin.from('cli_device_codes').update({ status: 'expired' }).eq('id', data.id as string)
    throw new Error('Device code has expired.')
  }

  const { error: updateError } = await admin
    .from('cli_device_codes')
    .update({
      user_id: params.userId,
      status: 'approved',
      approved_at: new Date().toISOString(),
    })
    .eq('id', data.id as string)

  if (updateError) {
    throw new Error(`Failed to approve CLI device: ${updateError.message}`)
  }
}

export async function pollCliDevice(params: {
  deviceCode: string
}): Promise<{ status: string; accessToken?: string }> {
  const admin = createAdminSupabaseClient()
  const deviceCodeHash = hashCliSecret(params.deviceCode)
  const { data, error } = await admin
    .from('cli_device_codes')
    .select('id, user_id, status, expires_at')
    .eq('device_code_hash', deviceCodeHash)
    .single()

  if (error || !data) {
    return { status: 'invalid' }
  }

  if (data.status === 'pending' && new Date(data.expires_at as string).getTime() < Date.now()) {
    await admin.from('cli_device_codes').update({ status: 'expired' }).eq('id', data.id as string)
    return { status: 'expired' }
  }

  if (data.status !== 'approved' || !data.user_id) {
    return { status: data.status as string }
  }

  const token = generateCliToken()
  const { error: insertError } = await admin.from('cli_tokens').insert({
    user_id: data.user_id as string,
    token_hash: hashCliSecret(token),
    name: 'PhysicsOS CLI',
    scopes: ['runner:submit', 'runner:read', 'runner:cancel', 'artifacts:read', 'account:read'],
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  })

  if (insertError) {
    throw new Error(`Failed to issue CLI token: ${insertError.message}`)
  }

  await admin.from('cli_device_codes').update({ status: 'revoked' }).eq('id', data.id as string)
  return { status: 'approved', accessToken: token }
}

export async function verifyCliBearerToken(header: string | null): Promise<{
  userId: string
  scopes: string[]
} | null> {
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  if (!token || !token.startsWith(CLI_TOKEN_PREFIX)) {
    return null
  }

  const admin = createAdminSupabaseClient()
  const tokenHash = hashCliSecret(token)
  const { data, error } = await admin
    .from('cli_tokens')
    .select('id, user_id, token_hash, scopes, expires_at, revoked_at')
    .eq('token_hash', tokenHash)
    .single()

  if (error || !data || data.revoked_at) {
    return null
  }

  if (data.expires_at && new Date(data.expires_at as string).getTime() < Date.now()) {
    return null
  }

  if (!safeEqual(data.token_hash as string, tokenHash)) {
    return null
  }

  await admin.from('cli_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', data.id as string)

  return {
    userId: data.user_id as string,
    scopes: Array.isArray(data.scopes) ? data.scopes as string[] : [],
  }
}
