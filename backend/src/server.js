import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'
import { createPool, migrate } from './db.js'

// Load backend/.env into process.env when present (no extra dependency).
const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 1) continue
    const key = t.slice(0, i).trim()
    let val = t.slice(i + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
    if (process.env[key] === undefined) process.env[key] = val
  }
}

const pool = createPool()
await migrate(pool)
const port = Number(process.env.PORT || 8000)
createApp({ pool }).listen(port, () => console.log(`GInI survey API listening on :${port}`))
