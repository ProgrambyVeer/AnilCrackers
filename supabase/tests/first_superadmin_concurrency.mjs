// Opt-in integration test of the actual manual script. Never part of npm test.
// Uses only the disposable local CLI database at 127.0.0.1:54322.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

if (process.argv[2] !== '--disposable-local-only') {
  throw new Error('Requires --disposable-local-only and a disposable local Supabase with migrations installed.')
}

function psql(sql, marker) {
  let ready
  const started = new Promise((resolve) => { ready = resolve })
  const child = spawn('psql', ['-X', '--no-password', '--host=127.0.0.1', '--port=54322', '--username=postgres', '--dbname=postgres', '--set=ON_ERROR_STOP=1', '--tuples-only', '--no-align'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PGHOSTADDR: '127.0.0.1', PGOPTIONS: '-c statement_timeout=15000 -c lock_timeout=10000' },
  })
  let stdout = ''
  let stderr = ''
  const done = new Promise((resolve, reject) => {
    child.on('error', (error) => { ready(); reject(error) })
    child.stdout.on('data', (data) => {
      stdout += data.toString()
      if (marker && stdout.includes(marker)) ready()
    })
    child.stderr.on('data', (data) => { stderr += data.toString() })
    child.on('close', (code) => {
      ready()
      resolve({ code, stdout, stderr })
    })
    child.stdin.on('error', reject)
  })
  child.stdin.end(sql)
  return { done, started }
}

async function query(sql) {
  const result = await psql(sql).done
  assert.equal(result.code, 0, 'Disposable PostgreSQL query failed; inspect local psql configuration.')
  return result.stdout.trim()
}

assert.equal(await query("select count(*) from public.profiles where role = 'superadmin';"), '0', 'Requires no existing Super Admin; refusing to run.')
const ids = [randomUUID(), randomUUID()]
const script = await readFile(new URL('../manual/first_superadmin.sql', import.meta.url), 'utf8')
function provisioning(id) {
  return script.replace('v_user_id uuid := null;', `v_user_id uuid := '${id}';`)
    .replace("v_confirmation text := '';", "v_confirmation text := 'PROVISION_FIRST_SUPERADMIN';")
}
const workers = []
try {
  for (const id of ids) {
    await query(`insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data)
      values ('${id}', 'authenticated', 'authenticated', '${id}@example.test', now(), '{"provider":"google"}');`)
  }
  const first = psql(`begin isolation level read committed;
    select pg_catalog.pg_advisory_xact_lock(741620, 1);
    select 'LOCK_ACQUIRED';
    select pg_sleep(3);
    ${provisioning(ids[0])}
    commit;`, 'LOCK_ACQUIRED')
  workers.push(first.done)
  await first.started
  const second = psql(provisioning(ids[1]))
  workers.push(second.done)
  let observedWaiting = false
  for (let attempt = 0; attempt < 20; attempt++) {
    const waiting = await query("select count(*) from pg_catalog.pg_locks where locktype = 'advisory' and classid = 741620 and objid = 1 and not granted;")
    if (Number(waiting) > 0) { observedWaiting = true; break }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.ok(observedWaiting, 'Must observe the second PostgreSQL session waiting for the provisioning lock')
  const [a, b] = await Promise.all(workers)
  assert.equal(a.code, 0, 'First provisioning execution must succeed')
  assert.notEqual(b.code, 0, 'Concurrent second execution must fail')
  assert.match(b.stderr, /A Super Admin already exists/)
  assert.equal(await query("select count(*) from public.profiles where role = 'superadmin';"), '1')
  assert.equal(await query(`select role from public.profiles where id = '${ids[0]}';`), 'superadmin')
  assert.equal(await query(`select count(*) from public.profiles where id = '${ids[1]}';`), '0')
  console.log('PASS: actual manual provisioning script serialized two PostgreSQL sessions.')
} finally {
  await Promise.allSettled(workers)
  await query(`delete from auth.users where id in ('${ids[0]}', '${ids[1]}');`)
}
