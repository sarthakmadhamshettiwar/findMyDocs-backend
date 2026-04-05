import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { query } from '../db/index.js'
import { shareFolderWith } from '../services/driveService.js'

const router = Router()
router.use(requireAuth)

// Get pending permissions the current user needs to grant
router.get('/pending', async (req, res) => {
  const userId = req.user.userId

  const result = await query(
    `SELECT pp.id, pp.to_user_id, pp.created_at,
            u.email as to_email, u.display_name as to_name
     FROM pending_permissions pp
     JOIN users u ON pp.to_user_id = u.id
     WHERE pp.from_user_id = $1 AND pp.status = 'pending'`,
    [userId]
  )

  res.json({ pending: result.rows })
})

// Grant access: share current user's folder with the requesting user
router.post('/grant/:permissionId', async (req, res) => {
  const userId = req.user.userId
  const { permissionId } = req.params

  const permResult = await query(
    `SELECT * FROM pending_permissions WHERE id = $1 AND from_user_id = $2 AND status = 'pending'`,
    [permissionId, userId]
  )
  if (!permResult.rows.length) {
    return res.status(404).json({ error: 'Permission request not found' })
  }
  const perm = permResult.rows[0]

  const toUserResult = await query('SELECT email FROM users WHERE id = $1', [perm.to_user_id])
  const toEmail = toUserResult.rows[0]?.email
  if (!toEmail) return res.status(404).json({ error: 'User not found' })

  await shareFolderWith(userId, toEmail)

  await query(
    `UPDATE pending_permissions SET status = 'granted' WHERE id = $1`,
    [permissionId]
  )

  res.json({ success: true })
})

export default router
