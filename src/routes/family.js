import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { query } from '../db/index.js'
import { shareFolderWith, revokeFolderAccess } from '../services/driveService.js'
import crypto from 'crypto'

const router = Router()
router.use(requireAuth)

// Create a new family (current user becomes admin)
router.post('/', async (req, res) => {
  const { name } = req.body
  const userId = req.user.userId

  const existing = await query('SELECT family_id FROM family_members WHERE user_id = $1', [userId])
  if (existing.rows.length > 0) {
    return res.status(400).json({ error: 'You are already in a family' })
  }

  const familyResult = await query(
    'INSERT INTO families (name, admin_id) VALUES ($1, $2) RETURNING *',
    [name ?? null, userId]
  )
  const family = familyResult.rows[0]

  await query(
    'INSERT INTO family_members (family_id, user_id, role) VALUES ($1, $2, $3)',
    [family.id, userId, 'admin']
  )

  res.status(201).json({ family })
})

// Get current user's family + members
router.get('/', async (req, res) => {
  const userId = req.user.userId

  const memberRow = await query('SELECT family_id FROM family_members WHERE user_id = $1', [userId])
  if (!memberRow.rows.length) {
    return res.status(404).json({ error: 'Not in a family' })
  }
  const familyId = memberRow.rows[0].family_id

  const [familyResult, membersResult] = await Promise.all([
    query('SELECT * FROM families WHERE id = $1', [familyId]),
    query(
      `SELECT u.id, u.email, u.display_name, fm.role, fm.joined_at
       FROM family_members fm JOIN users u ON fm.user_id = u.id
       WHERE fm.family_id = $1`,
      [familyId]
    ),
  ])

  res.json({ family: familyResult.rows[0], members: membersResult.rows })
})

// Invite a user by email
router.post('/invite', async (req, res) => {
  const { email } = req.body
  const userId = req.user.userId

  if (!email) return res.status(400).json({ error: 'email is required' })

  const memberRow = await query(
    'SELECT family_id, role FROM family_members WHERE user_id = $1', [userId]
  )
  if (!memberRow.rows.length) return res.status(400).json({ error: 'Not in a family' })

  const { family_id: familyId, role } = memberRow.rows[0]
  if (role !== 'admin') return res.status(403).json({ error: 'Only admin can invite' })

  const token = crypto.randomBytes(24).toString('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

  const invite = await query(
    `INSERT INTO invites (family_id, invited_email, token, expires_at)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [familyId, email, token, expiresAt]
  )

  // TODO: send email. For now return the invite link.
  res.status(201).json({
    invite: invite.rows[0],
    inviteLink: `${process.env.APP_URL ?? 'http://localhost:8082'}?inviteToken=${token}`,
  })
})

// Remove a member
router.delete('/members/:memberId', async (req, res) => {
  const adminId = req.user.userId
  const { memberId } = req.params

  const adminRow = await query(
    'SELECT family_id, role FROM family_members WHERE user_id = $1', [adminId]
  )
  if (!adminRow.rows.length) return res.status(400).json({ error: 'Not in a family' })

  const { family_id: familyId, role } = adminRow.rows[0]
  if (role !== 'admin') return res.status(403).json({ error: 'Only admin can remove members' })

  // Get emails for Drive permission revocation
  const [adminUser, memberUser] = await Promise.all([
    query('SELECT email FROM users WHERE id = $1', [adminId]),
    query('SELECT email FROM users WHERE id = $1', [memberId]),
  ])

  const memberEmail = memberUser.rows[0]?.email
  const adminEmail = adminUser.rows[0]?.email

  // Get all remaining members to revoke cross-access
  const allMembers = await query(
    'SELECT user_id FROM family_members WHERE family_id = $1 AND user_id != $2',
    [familyId, memberId]
  )

  // Revoke: each remaining member's folder from removed member, and vice versa
  await Promise.allSettled([
    ...allMembers.rows.map(m => revokeFolderAccess(m.user_id, memberEmail)),
    revokeFolderAccess(memberId, adminEmail),
  ])

  await query(
    'DELETE FROM family_members WHERE family_id = $1 AND user_id = $2',
    [familyId, memberId]
  )

  await query(
    'DELETE FROM pending_permissions WHERE family_id = $1 AND (from_user_id = $2 OR to_user_id = $2)',
    [familyId, memberId]
  )

  res.json({ success: true })
})

export default router
