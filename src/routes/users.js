import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { query } from '../db/index.js'

const router = Router()
router.use(requireAuth)

// Sync drive root folder ID and FCM token for current user
router.put('/me', async (req, res) => {
  const { driveRootFolderId, fcmToken } = req.body
  const userId = req.user.userId

  await query(
    `UPDATE users SET
      drive_root_folder_id = COALESCE($1, drive_root_folder_id),
      fcm_token = COALESCE($2, fcm_token)
     WHERE id = $3`,
    [driveRootFolderId ?? null, fcmToken ?? null, userId]
  )

  res.json({ success: true })
})

export default router
