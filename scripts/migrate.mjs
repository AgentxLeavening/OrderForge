#!/usr/bin/env node
// Applies SQL files in db/migrations/ in filename order against the Supabase
// Postgres database. Tracks applied files in a schema_migrations table so it's
// safe to run repeatedly — only pending migrations are applied.
//
// Usage:  npm run migrate
//
// Connection string is read from (first found):
//   process.env.SUPABASE_DB_URL / DATABASE_URL, then the same keys in .env.local
// Get it from Supabase → Project Settings → Database → Connection string (URI).

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = join(root, 'db', 'migrations')

// Minimal .env.local loader (avoids a dotenv dependency).
function loadEnvLocal() {
  const p = join(root, '.env.local')
  const out = {}
  if (!existsSync(p)) return out
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

const fileEnv = loadEnvLocal()
const connectionString =
  process.env.SUPABASE_DB_URL ||
  process.env.DATABASE_URL ||
  fileEnv.SUPABASE_DB_URL ||
  fileEnv.DATABASE_URL

if (!connectionString) {
  console.error(
    '\n✖ No database connection string found.\n\n' +
    'Add one to .env.local (or your shell) as SUPABASE_DB_URL, e.g.:\n\n' +
    '  SUPABASE_DB_URL="postgresql://postgres:[PASSWORD]@db.<ref>.supabase.co:5432/postgres"\n\n' +
    'Find it in Supabase → Project Settings → Database → Connection string (URI).\n'
  )
  process.exit(1)
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })

async function main() {
  await client.connect()

  await client.query(`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `)

  const { rows } = await client.query('select name from schema_migrations')
  const applied = new Set(rows.map(r => r.name))

  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
  const pending = files.filter(f => !applied.has(f))

  if (pending.length === 0) {
    console.log('✓ No pending migrations — database is up to date.')
    return
  }

  console.log(`Applying ${pending.length} migration(s):`)
  for (const file of pending) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8')
    process.stdout.write(`  → ${file} ... `)
    try {
      await client.query('begin')
      await client.query(sql)
      await client.query('insert into schema_migrations(name) values ($1)', [file])
      await client.query('commit')
      console.log('done')
    } catch (err) {
      await client.query('rollback').catch(() => {})
      console.log('FAILED')
      console.error(`\n✖ ${file} failed:\n${err.message}\n`)
      process.exit(1)
    }
  }
  console.log('✓ All migrations applied.')
}

main()
  .catch(err => {
    console.error('\n✖ Migration run failed:\n' + (err?.message || err) + '\n')
    process.exitCode = 1
  })
  .finally(() => client.end())
