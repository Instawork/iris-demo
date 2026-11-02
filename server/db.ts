import { Pool } from "pg"

import type { DemoData } from "@/lib/types"

/**
 * Postgres persistence for tenants. Each tenant's data is one JSONB document, written on every change, and every
 * change is also appended to an event log for the audit trail. Without DATABASE_URL the server keeps state in memory.
 */

declare global {
  var __irisPool: Pool | undefined
  var __irisSchema: Promise<void> | undefined
}

export const hasDatabase = () => !!process.env.DATABASE_URL

function pool() {
  globalThis.__irisPool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    ssl: process.env.DATABASE_SSL === "require" ? { rejectUnauthorized: false } : undefined,
  })
  return globalThis.__irisPool
}

const SCHEMA = `
create table if not exists iris_tenants (
  id text primary key,
  version bigint not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists iris_events (
  tenant_id text not null,
  seq bigint not null,
  at timestamptz not null default now(),
  actor text,
  workspace_id text,
  kind text not null,
  input jsonb,
  changes jsonb,
  primary key (tenant_id, seq)
);
create table if not exists iris_checkpoints (
  tenant_id text not null,
  name text not null,
  data jsonb not null,
  saved_at timestamptz not null default now(),
  primary key (tenant_id, name)
);
`

async function ready() {
  globalThis.__irisSchema ??= pool()
    .query(SCHEMA)
    .then(() => undefined)
    .catch((error) => {
      globalThis.__irisSchema = undefined
      throw error
    })
  return globalThis.__irisSchema
}

export async function loadTenantRow(id: string): Promise<{ version: number; data: DemoData } | null> {
  await ready()
  const { rows } = await pool().query<{ version: string; data: DemoData }>("select version, data from iris_tenants where id = $1", [id])
  return rows[0] ? { version: Number(rows[0].version), data: rows[0].data } : null
}

/** The tenant's data as the guided demo found it at the start of a step, so a jump back can put it back. */
export async function saveCheckpointRow(id: string, name: string, json: string) {
  await ready()
  await pool().query("insert into iris_checkpoints (tenant_id, name, data) values ($1, $2, $3) on conflict (tenant_id, name) do update set data = $3, saved_at = now()", [id, name, json])
}

/** The checkpoint as JSON text. */
export async function loadCheckpointRow(id: string, name: string): Promise<string | null> {
  await ready()
  const { rows } = await pool().query<{ data: string }>("select data::text as data from iris_checkpoints where tenant_id = $1 and name = $2", [id, name])
  return rows[0]?.data ?? null
}

export async function clearCheckpointRows(id: string) {
  await ready()
  await pool().query("delete from iris_checkpoints where tenant_id = $1", [id])
}

export interface EventRow {
  seq: number
  actor?: string
  workspaceId?: string
  kind: string
  input?: unknown
  changes?: unknown
}

/** Writes the new state only if nobody else moved the version, so a second server instance can't silently overwrite. */
export async function saveTenantRow(id: string, previousVersion: number, version: number, data: DemoData, event: EventRow) {
  await ready()
  const client = await pool().connect()
  try {
    await client.query("begin")
    const result =
      previousVersion === 0
        ? await client.query("insert into iris_tenants (id, version, data) values ($1, $2, $3) on conflict (id) do update set version = $2, data = $3, updated_at = now()", [
            id,
            version,
            JSON.stringify(data),
          ])
        : await client.query("update iris_tenants set version = $3, data = $4, updated_at = now() where id = $1 and version = $2", [
            id,
            previousVersion,
            version,
            JSON.stringify(data),
          ])
    if (result.rowCount !== 1) throw new Error(`Tenant ${id} changed on another server (expected version ${previousVersion})`)
    await client.query("insert into iris_events (tenant_id, seq, actor, workspace_id, kind, input, changes) values ($1, $2, $3, $4, $5, $6, $7)", [
      id,
      event.seq,
      event.actor ?? null,
      event.workspaceId ?? null,
      event.kind,
      event.input === undefined ? null : JSON.stringify(event.input),
      event.changes === undefined ? null : JSON.stringify(event.changes),
    ])
    await client.query("commit")
  } catch (error) {
    await client.query("rollback").catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}
