import { query } from '../db/index.js'

export async function sendPushNotification(token, title, body) {
  if (!token) return
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: token, title, body, sound: 'default' }),
  })
}

export async function notifyFamilyMembers(familyId, excludeUserId, title, body) {
  const result = await query(
    `SELECT u.fcm_token FROM family_members fm
     JOIN users u ON fm.user_id = u.id
     WHERE fm.family_id = $1 AND fm.user_id != $2 AND u.fcm_token IS NOT NULL`,
    [familyId, excludeUserId]
  )
  await Promise.allSettled(
    result.rows.map(row => sendPushNotification(row.fcm_token, title, body))
  )
}
