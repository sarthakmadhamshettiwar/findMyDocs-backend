import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { query } from '../db/index.js'
import { shareFolderWith } from '../services/driveService.js'
import { notifyFamilyMembers } from '../services/notificationService.js'

const router = Router()
router.use(requireAuth)

// Get all pending invites for the current user's email
router.get('/pending', async (req, res) => {
  const userResult = await query('SELECT email FROM users WHERE id = $1', [req.user.userId])
  const email = userResult.rows[0]?.email
  if (!email) return res.json({ invites: [] })

  const result = await query(
    `SELECT i.token, i.expires_at, f.name as family_name
     FROM invites i JOIN families f ON i.family_id = f.id
     WHERE i.invited_email = $1 AND i.status = 'pending' AND i.expires_at > NOW()`,
    [email]
  )
  res.json({ invites: result.rows })
})

// Accept an invite by token
router.post('/:token/accept', async (req, res) => {
  const { token } = req.params
  const { rootFolderId } = req.body   // new user's findMyDocs folder ID
  const userId = req.user.userId

  const inviteResult = await query(
    `SELECT * FROM invites WHERE token = $1 AND status = 'pending' AND expires_at > NOW()`,
    [token]
  )
  if (!inviteResult.rows.length) {
    return res.status(400).json({ error: 'Invalid or expired invite' })
  }
  const invite = inviteResult.rows[0]

  // Check user is not already in a family
  const existing = await query('SELECT 1 FROM family_members WHERE user_id = $1', [userId])
  if (existing.rows.length) {
    return res.status(400).json({ error: 'Already in a family' })
  }

  // Store root folder ID + add to family
  await Promise.all([
    rootFolderId
      ? query('UPDATE users SET drive_root_folder_id = $1 WHERE id = $2', [rootFolderId, userId])
      : Promise.resolve(),
    query(
      'INSERT INTO family_members (family_id, user_id, role) VALUES ($1, $2, $3)',
      [invite.family_id, userId, 'member']
    ),
    query('UPDATE invites SET status = $1 WHERE id = $2', ['accepted', invite.id]),
  ])

  // Get existing members (excluding the new user)
  const membersResult = await query(
    `SELECT u.id, u.email FROM family_members fm
     JOIN users u ON fm.user_id = u.id
     WHERE fm.family_id = $1 AND fm.user_id != $2`,
    [invite.family_id, userId]
  )
  const existingMembers = membersResult.rows

  const newUserResult = await query('SELECT email FROM users WHERE id = $1', [userId])
  const newUserEmail = newUserResult.rows[0].email

  // Share new user's folder with all existing members
  if (rootFolderId) {
    await Promise.allSettled(
      existingMembers.map(m => shareFolderWith(userId, m.email))
    )
  }

  // Create pending_permissions: each existing member needs to grant access to new user
  await Promise.all(
    existingMembers.map(m =>
      query(
        `INSERT INTO pending_permissions (family_id, from_user_id, to_user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [invite.family_id, m.id, userId]
      )
    )
  )

  const newUserName = await query('SELECT display_name FROM users WHERE id = $1', [userId])
  const name = newUserName.rows[0]?.display_name ?? 'Someone'
  await notifyFamilyMembers(invite.family_id, userId, 'New Family Member', `${name} joined your family`)

  res.json({ success: true, familyId: invite.family_id })
})

export default router
