// MySQL access (mysql2/promise). Tables are created on start-up if missing.
// Tested on MySQL 8 and MariaDB 10.11. JSON columns are parsed on read for both.
import mysql from 'mysql2/promise'

export function createPool(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL is required, e.g. mysql://gini:secret@localhost:3306/gini')
  return mysql.createPool({ uri: url, timezone: 'Z', connectionLimit: 10, charset: 'utf8mb4' })
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS organizations (
     code VARCHAR(40) PRIMARY KEY,
     name VARCHAR(200), unit_type VARCHAR(80), sector VARCHAR(120), geography VARCHAR(200),
     reporting_period VARCHAR(80), boundary TEXT, intended_external_beneficiaries TEXT,
     external_value_in_scope TINYINT(1) NOT NULL DEFAULT 1,
     status VARCHAR(10) NOT NULL DEFAULT 'open', closed_at DATETIME(3) NULL, created_at DATETIME(3) NOT NULL
   ) CHARACTER SET utf8mb4`,
  `CREATE TABLE IF NOT EXISTS responses (
     code VARCHAR(20) PRIMARY KEY,
     token_hash CHAR(64) NOT NULL UNIQUE,
     org_code VARCHAR(40) NOT NULL, role INT NOT NULL,
     consent_version VARCHAR(20), consent_at DATETIME(3),
     answers JSON NOT NULL, status VARCHAR(10) NOT NULL DEFAULT 'draft',
     instrument_version VARCHAR(20), created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
     submitted_at DATETIME(3) NULL,
     INDEX idx_resp_org (org_code)
   ) CHARACTER SET utf8mb4`,
  // Identities stored separately from response data (Guide §5 step 05, §15).
  `CREATE TABLE IF NOT EXISTS contacts (
     id INT AUTO_INCREMENT PRIMARY KEY, respondent_code VARCHAR(20) NOT NULL, contact VARCHAR(200) NOT NULL,
     created_at DATETIME(3) NOT NULL, INDEX idx_contact_resp (respondent_code)
   ) CHARACTER SET utf8mb4`,
  `CREATE TABLE IF NOT EXISTS analyst_ratings (
     id INT AUTO_INCREMENT PRIMARY KEY, org_code VARCHAR(40) NOT NULL, kind VARCHAR(4) NOT NULL, ref VARCHAR(60) NOT NULL,
     ratings JSON NOT NULL, note TEXT, updated_at DATETIME(3) NOT NULL,
     UNIQUE KEY uq_rating (org_code, kind, ref)
   ) CHARACTER SET utf8mb4`,
]

export async function migrate(pool) {
  for (const sql of SCHEMA) await pool.query(sql)
}

const parseJson = v => (typeof v === 'string' ? JSON.parse(v) : Buffer.isBuffer(v) ? JSON.parse(v.toString('utf8')) : v)

export function rowToResponse(r) {
  return r && { ...r, answers: parseJson(r.answers) || {} }
}
export function rowToOrg(o) {
  return o && { ...o, external_value_in_scope: !!o.external_value_in_scope }
}
export function rowToRating(x) {
  return x && { ...x, ratings: parseJson(x.ratings) }
}
