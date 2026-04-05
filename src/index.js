import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import authRouter from './routes/auth.js'
import familyRouter from './routes/family.js'
import invitesRouter from './routes/invites.js'
import permissionsRouter from './routes/permissions.js'
import usersRouter from './routes/users.js'
import filesRouter from './routes/files.js'

const app = express()
app.use(cors())
app.use(express.json())
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.path}`)
  next()
})

app.use('/api/v1/auth', authRouter)
app.use('/api/v1/family', familyRouter)
app.use('/api/v1/invites', invitesRouter)
app.use('/api/v1/permissions', permissionsRouter)
app.use('/api/v1/users', usersRouter)
app.use('/api/v1/files', filesRouter)

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Server running on port ${PORT}`))
