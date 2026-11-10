import { createApp } from './app.js'
import { createPool, migrate } from './db.js'

const pool = createPool()
await migrate(pool)
const port = Number(process.env.PORT || 8000)
createApp({ pool }).listen(port, () => console.log(`GInI survey API listening on :${port}`))
