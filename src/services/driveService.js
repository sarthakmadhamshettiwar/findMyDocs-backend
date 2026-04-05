import { OAuth2Client } from 'google-auth-library'
import { query } from '../db/index.js'

async function getAccessTokenForUser(userId) {
  const result = await query('SELECT refresh_token FROM users WHERE id = $1', [userId])
  const refreshToken = result.rows[0]?.refresh_token
  if (!refreshToken) throw new Error('No refresh token stored for user')

  const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET)
  client.setCredentials({ refresh_token: refreshToken })
  const { credentials } = await client.refreshAccessToken()
  return credentials.access_token
}

// Share ownerUserId's findMyDocs folder with targetEmail (read-only)
export async function shareFolderWith(ownerUserId, targetEmail) {
  const result = await query('SELECT drive_root_folder_id FROM users WHERE id = $1', [ownerUserId])
  const folderId = result.rows[0]?.drive_root_folder_id
  if (!folderId) return // folder not created yet, skip silently

  const accessToken = await getAccessTokenForUser(ownerUserId)

  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}/permissions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'user', role: 'reader', emailAddress: targetEmail }),
  })

  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error?.message || 'Failed to share folder')
  }
}

// Revoke targetEmail's access to ownerUserId's folder
export async function revokeFolderAccess(ownerUserId, targetEmail) {
  const result = await query('SELECT drive_root_folder_id FROM users WHERE id = $1', [ownerUserId])
  const folderId = result.rows[0]?.drive_root_folder_id
  if (!folderId) return

  const accessToken = await getAccessTokenForUser(ownerUserId)

  // Find permission ID for this email
  const listRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${folderId}/permissions?fields=permissions(id,emailAddress)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  const listData = await listRes.json()
  const permission = listData.permissions?.find(p => p.emailAddress === targetEmail)
  if (!permission) return

  await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}/permissions/${permission.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}
