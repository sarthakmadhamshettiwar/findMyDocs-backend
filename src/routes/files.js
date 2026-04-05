import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { query } from '../db/index.js'
import { OAuth2Client } from 'google-auth-library'
import { notifyFamilyMembers } from '../services/notificationService.js'

const router = Router()
router.use(requireAuth)

const DRIVE_BASE = 'https://www.googleapis.com/drive/v3'

async function getAccessToken(userId) {
  const result = await query('SELECT refresh_token FROM users WHERE id = $1', [userId])
  const refreshToken = result.rows[0]?.refresh_token
  if (!refreshToken) throw new Error('No refresh token')
  const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET)
  client.setCredentials({ refresh_token: refreshToken })
  const { credentials } = await client.refreshAccessToken()
  return credentials.access_token
}

async function driveGet(url, accessToken) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) return null
  return res.json()
}

async function findFolder(name, parentId, accessToken) {
  const q = `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
  const data = await driveGet(`${DRIVE_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id)`, accessToken)
  return data?.files?.[0]?.id ?? null
}

async function getFamilyMembers(userId) {
  const memberRow = await query('SELECT family_id FROM family_members WHERE user_id = $1', [userId])
  if (!memberRow.rows.length) return []
  const familyId = memberRow.rows[0].family_id
  const result = await query(
    `SELECT u.id, u.display_name, u.drive_root_folder_id
     FROM family_members fm JOIN users u ON fm.user_id = u.id
     WHERE fm.family_id = $1 AND u.drive_root_folder_id IS NOT NULL`,
    [familyId]
  )
  return result.rows
}

// List files in a category/subcategory across all family members
router.get('/list', async (req, res) => {
  const { category, subcategory } = req.query
  if (!category || !subcategory) return res.status(400).json({ error: 'category and subcategory required' })

  const members = await getFamilyMembers(req.user.userId)

  const results = await Promise.allSettled(
    members.map(async member => {
      const accessToken = await getAccessToken(member.id)
      const catId = await findFolder(category, member.drive_root_folder_id, accessToken)
      if (!catId) return []
      const subId = await findFolder(subcategory, catId, accessToken)
      if (!subId) return []

      const q = `'${subId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed=false`
      const data = await driveGet(
        `${DRIVE_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,createdTime)`,
        accessToken
      )
      return (data?.files ?? []).map(f => ({
        ...f,
        ownerName: member.display_name,
        ownerId: member.id,
      }))
    })
  )

  const files = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime))

  res.json({ files })
})

// Search files by name across all family members
router.get('/search', async (req, res) => {
  const { q: queryText } = req.query
  if (!queryText?.trim()) return res.json({ files: [] })

  const members = await getFamilyMembers(req.user.userId)

  const results = await Promise.allSettled(
    members.map(async member => {
      const accessToken = await getAccessToken(member.id)
      const q = `name contains '${queryText.replace(/'/g, "\\'")}' and mimeType != 'application/vnd.google-apps.folder' and trashed=false`
      const data = await driveGet(
        `${DRIVE_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,createdTime,parents)`,
        accessToken
      )
      const files = data?.files ?? []

      // Resolve category/subcategory path for each file
      return Promise.all(files.map(async file => {
        const subFolder = file.parents?.[0]
          ? await driveGet(`${DRIVE_BASE}/files/${file.parents[0]}?fields=id,name,parents`, accessToken)
          : null
        const catFolder = subFolder?.parents?.[0]
          ? await driveGet(`${DRIVE_BASE}/files/${subFolder.parents[0]}?fields=id,name`, accessToken)
          : null
        return {
          ...file,
          subcategory: subFolder?.name ?? null,
          category: catFolder?.name ?? null,
          ownerName: member.display_name,
          ownerId: member.id,
        }
      }))
    })
  )

  const files = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)

  res.json({ files })
})

// Notify family members after a file upload (client calls this after Drive upload)
router.post('/notify-upload', async (req, res) => {
  const { fileName, category, subcategory } = req.body
  const userId = req.user.userId

  const memberRow = await query('SELECT family_id FROM family_members WHERE user_id = $1', [userId])
  if (!memberRow.rows.length) return res.json({ success: true })

  const familyId = memberRow.rows[0].family_id
  const userResult = await query('SELECT display_name FROM users WHERE id = $1', [userId])
  const name = userResult.rows[0]?.display_name ?? 'Someone'

  await notifyFamilyMembers(
    familyId, userId,
    'New Document',
    `${name} uploaded ${fileName} to ${category} > ${subcategory}`
  )

  res.json({ success: true })
})

// Get view URL for a file (using owner's token)
router.get('/:fileId/url', async (req, res) => {
  const { ownerId } = req.query
  if (!ownerId) return res.status(400).json({ error: 'ownerId required' })

  const accessToken = await getAccessToken(ownerId)
  const data = await driveGet(
    `${DRIVE_BASE}/files/${req.params.fileId}?fields=webViewLink`,
    accessToken
  )
  if (!data?.webViewLink) return res.status(404).json({ error: 'File not found' })
  res.json({ webViewLink: data.webViewLink })
})

export default router
