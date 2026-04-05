import 'dotenv/config'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { query } from './index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const migrations = ['001_initial.sql', '002_drive_root_folder.sql']

for (const file of migrations) {
  const sql = readFileSync(join(__dirname, 'migrations', file), 'utf8')
  try {
    await query(sql)
    console.log(`✓ ${file}`)
  } catch (err) {
    console.error(`✗ ${file}: ${err.message}`)
    process.exit(1)
  }
}

console.log('All migrations complete')
