// Loads backend/instrument.json (single source of truth) and derives routing, lookups and labels.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT = path.resolve(here, '../instrument.json')

let cache = null
export function instrument() {
  if (!cache) cache = JSON.parse(fs.readFileSync(process.env.INSTRUMENT_PATH || DEFAULT, 'utf8'))
  return cache
}

let itemsCache = null
export function items() {
  if (!itemsCache) {
    itemsCache = {}
    for (const s of instrument().sections) for (const q of s.items) itemsCache[q.id] = { ...q, section: s.id }
    for (const q of instrument().declaration) itemsCache[q.id] = { ...q, section: 'DEC' }
  }
  return itemsCache
}

export function role(code) {
  const r = instrument().roles[String(code)]
  if (!r) throw new Error('Unknown role')
  return r
}

/** Item IDs a respondent in this role may answer (survey "Role Routing" table). */
export function routedItems(roleCode) {
  const r = role(roleCode)
  const secs = Object.fromEntries(instrument().sections.map(s => [s.id, s]))
  const allowed = new Set()
  for (const m of r.modules) {
    const only = r.only?.[m]
    for (const id of only || secs[m].items.map(q => q.id)) allowed.add(id)
  }
  for (const q of instrument().declaration) allowed.add(q.id)
  return allowed
}

export const isInternal = code => role(code).internal !== false && role(code).name !== 'Other'

/** F-section answers for initiative n>1 are stored as 'F7#2'. */
export const baseId = key => key.split('#')[0]

/** Stable export variable: zero-padded number (C7 -> C07); G3a, G1X unchanged. */
export function varName(id) {
  const m = /^([A-Z]+)(\d+)$/.exec(id)
  return m ? `${m[1]}${m[2].padStart(2, '0')}` : id
}

export const optionLabel = (options, code) => (options || []).find(([c]) => c === code)?.[1] ?? null
export const scaleOptions = kind => instrument().scales[kind] || null
