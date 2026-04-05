import { Router } from 'express'
import { OAuth2Client } from 'google-auth-library'
import jwt from 'jsonwebtoken'
import { query } from '../db/index.js'

const router = Router()

function makeOAuthClient(redirectUri = 'postmessage') {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  )
}

router.post('/google', async (req, res) => {
  const { code, redirectUri } = req.body

  if (!code) {
    return res.status(400).json({ error: 'code is required' })
  }

  let tokens
  try {
    const client = makeOAuthClient(redirectUri ?? 'postmessage')
    const response = await client.getToken(code)
    tokens = response.tokens
  } catch {
    return res.status(401).json({ error: 'Failed to exchange auth code' })
  }

  // Verify the id_token to get user info
  let payload
  try {
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    })
    payload = ticket.getPayload()
  } catch {
    return res.status(401).json({ error: 'Invalid id_token' })
  }

  const { sub: googleId, email, name: displayName } = payload

  const result = await query(
    `INSERT INTO users (google_id, email, display_name, refresh_token)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (google_id) DO UPDATE
       SET email         = EXCLUDED.email,
           display_name  = EXCLUDED.display_name,
           refresh_token = COALESCE(EXCLUDED.refresh_token, users.refresh_token)
     RETURNING id, email, display_name`,
    [googleId, email, displayName, tokens.refresh_token ?? null]
  )

  const user = result.rows[0]
  const token = jwt.sign(
    { userId: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  )

  res.json({
    token,
    user: { id: user.id, email: user.email, displayName: user.display_name },
    accessToken: tokens.access_token,
  })
})

export default router
