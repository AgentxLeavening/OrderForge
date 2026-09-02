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
const pick = (k) => process.env[k] || fileEnv[k]

const connectionString = pick('SUPABASE_DB_URL') || pick('DATABASE_URL')

// Discrete parts let passwords with special characters (@ : / ? # etc.) work
// without URL-encoding — Supabase passwords often contain them.
const discrete = {
  host: pick('SUPABASE_DB_HOST'),
  port: Number(pick('SUPABASE_DB_PORT') || 5432),
  user: pick('SUPABASE_DB_USER'),
  password: pick('SUPABASE_DB_PASSWORD'),
  database: pick('SUPABASE_DB_NAME') || 'postgres',
}

const discreteHelp =
  '  SUPABASE_DB_HOST=aws-0-<region>.pooler.supabase.com\n' +
  '  SUPABASE_DB_PORT=5432\n' +
  '  SUPABASE_DB_USER=postgres.qpbvvkgxlctnthlzusml\n' +
  '  SUPABASE_DB_PASSWORD=your-raw-password   (no quotes/encoding needed)\n'

// Catch leftover template placeholders like <your-region> / <ref> before we
// hit a confusing DNS/parse error.
for (const [k, v] of Object.entries({ ...discrete, SUPABASE_DB_URL: connectionString })) {
  if (typeof v === 'string' && /[<>]/.test(v)) {
    console.error(`\n✖ ${k} still contains a "<...>" placeholder ("${v}"). Replace it with the real value from your Supabase connection string.\n`)
    process.exit(1)
  }
}

let clientConfig
if (discrete.host && discrete.user && discrete.password) {
  clientConfig = { ...discrete, ssl: { rejectUnauthorized: false } }
} else if (connectionString) {
  if (/[[\]]/.test(connectionString)) {
    console.error(
      '\n✖ SUPABASE_DB_URL still contains "[" or "]".\n\n' +
      'Looks like the [YOUR-DB-PASSWORD] placeholder is still there — replace it with your real password.\n'
    )
    process.exit(1)
  }
  clientConfig = { connectionString, ssl: { rejectUnauthorized: false } }
} else {
  console.error(
    '\n✖ No database connection settings found.\n\n' +
    'Add EITHER a full URL to .env.local:\n\n' +
    '  SUPABASE_DB_URL="postgresql://postgres.<ref>:[PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres"\n\n' +
    'OR the discrete parts (best if your password has special characters):\n\n' +
    discreteHelp +
    '\nGet these from Supabase → Project Settings → Database → Connection string.\n'
  )
  process.exit(1)
}

let client
try {
  client = new pg.Client(clientConfig)
} catch (err) {
  console.error(
    '\n✖ Could not parse the connection settings: ' + err.message + '\n\n' +
    'If your password has special characters (@ : / ? # etc.), skip URL-encoding and use the discrete vars in .env.local instead:\n\n' +
    discreteHelp
  )
  process.exit(1)
}

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
