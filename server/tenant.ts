import { PROGRAM_TIME_ZONE, todayISO } from "@/lib/dates"
import type { Notice } from "@/lib/domain/commands"
import { advance } from "@/lib/domain/simulate"
import { diffData, isEmptyChange, type Changes } from "@/lib/domain/sync"
import { findWorkspace, syncDirectory } from "@/lib/reference"
import { DATA_VERSION, generateDemoData } from "@/lib/seed"
import { seedSourcing } from "@/lib/sourcing"
import type { DemoData } from "@/lib/types"
import { hasDatabase, loadTenantRow, saveTenantRow } from "@/server/db"

// The seed writes venue times through the local clock, so the server's local clock is the program's.
process.env.TZ = PROGRAM_TIME_ZONE

/**
 * One demo tenant: the authoritative copy of its data, a queue that applies one change at a time, and the devices
 * listening for changes. The server is meant to run as a single instance; the version check in the database stops
 * a second instance from overwriting changes it didn't see.
 */

export interface TenantEvent {
  kind: "change" | "reset"
  version: number
  changes?: Changes
  notices?: Notice[]
}

export interface Mutation<R> {
  data: DemoData
  result: R
  notices?: Notice[]
  replaced?: boolean
}

export interface Applied<R> {
  result: R
  version: number
  changes?: Changes
  replaced: boolean
}

interface MutationMeta {
  kind: string
  actor?: string
  workspaceId?: string
  input?: unknown
}

type Listener = (event: TenantEvent) => void

const TICK_MS = 2200
const MAX_LOGGED_INPUT = 20_000

const loggable = (input: unknown) => {
  if (input === undefined) return undefined
  const text = JSON.stringify(input)
  return text.length > MAX_LOGGED_INPUT ? { truncated: true, bytes: text.length } : input
}

export class Tenant {
  private queue: Promise<unknown> = Promise.resolve()
  private listeners = new Map<Listener, string | undefined>()
  private recent = new Map<string, Applied<unknown>>()
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(
    readonly id: string,
    public version: number,
    public data: DemoData,
  ) {
    syncDirectory(data.directory)
  }

  /** Workspaces with a device connected right now. */
  connectedWorkspaces() {
    return new Set([...this.listeners.values()].filter(Boolean) as string[])
  }

  subscribe(listener: Listener, workspaceId?: string) {
    this.listeners.set(listener, workspaceId)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(event: TenantEvent) {
    for (const listener of this.listeners.keys()) {
      try {
        listener(event)
      } catch {
        this.listeners.delete(listener)
      }
    }
  }

  /** Applies one change at a time, saves it, then tells every connected device. */
  mutate<R>(meta: MutationMeta, fn: (data: DemoData) => Mutation<R>): Promise<Applied<R>> {
    const run = async (): Promise<Applied<R>> => {
      syncDirectory(this.data.directory)
      const outcome = fn(this.data)
      const unchanged: Applied<R> = { result: outcome.result, version: this.version, replaced: false }
      if (outcome.data === this.data && !outcome.replaced) return unchanged
      const changes = outcome.replaced ? undefined : diffData(this.data, outcome.data)
      if (changes && isEmptyChange(changes)) return unchanged
      const version = this.version + 1
      if (hasDatabase()) {
        await saveTenantRow(this.id, this.version, version, outcome.data, {
          seq: version,
          actor: meta.actor,
          workspaceId: meta.workspaceId,
          kind: meta.kind,
          input: loggable(meta.input),
          changes: changes && JSON.stringify(changes).length <= MAX_LOGGED_INPUT * 10 ? changes : undefined,
        })
      }
      this.version = version
      this.data = outcome.data
      syncDirectory(this.data.directory)
      if (outcome.replaced) this.recent.clear()
      this.emit({ kind: outcome.replaced ? "reset" : "change", version, changes, notices: outcome.notices })
      return { result: outcome.result, version, changes, replaced: !!outcome.replaced }
    }
    const next = this.queue.then(run, run)
    this.queue = next.catch(() => undefined)
    return next
  }

  /** Same command sent twice with one key (a double click, an agent retry) returns the first answer. */
  rememberedResult(key: string) {
    return this.recent.get(key)
  }

  remember(key: string, applied: Applied<unknown>) {
    this.recent.set(key, applied)
    if (this.recent.size > 500) this.recent.delete(this.recent.keys().next().value!)
  }

  start() {
    if (this.timer) return
    this.timer = setInterval(() => {
      const playing = playedSuppliers(this.connectedWorkspaces())
      void this.mutate({ kind: "tick", actor: "Iris" }, (data) => {
        const paused = new Set(data.settings?.pausedAgencies ?? [])
        const { data: next, notices } = advance(data, { now: new Date(), simulated: (supplierId) => !playing.has(supplierId) && !paused.has(supplierId) })
        return { data: next, result: null, notices }
      }).catch((error) => console.error(`[iris] scheduler tick failed for ${this.id}`, error))
    }, TICK_MS)
    this.timer.unref?.()
  }
}

/** An agency is played by a person while someone is signed in as it; otherwise the server staffs its shifts. */
const playedSuppliers = (connected: Set<string>) => new Set([...connected].map((id) => findWorkspace(id)?.supplierId).filter(Boolean) as string[])

declare global {
  var __irisTenants: Map<string, Promise<Tenant>> | undefined
}

async function load(id: string) {
  const row = hasDatabase() ? await loadTenantRow(id) : null
  if (row && row.data.version === DATA_VERSION && row.data.groups?.length) {
    row.data.sourcing ??= seedSourcing(row.data, todayISO())
    const tenant = new Tenant(id, row.version, row.data)
    tenant.start()
    return tenant
  }
  const data = generateDemoData()
  const version = (row?.version ?? 0) + 1
  if (hasDatabase()) await saveTenantRow(id, row?.version ?? 0, version, data, { seq: version, kind: "seed", actor: "Iris" })
  const tenant = new Tenant(id, version, data)
  tenant.start()
  return tenant
}

export const defaultTenantId = () => process.env.IRIS_TENANT || "demo"

export function getTenant(id = defaultTenantId()) {
  const tenants = (globalThis.__irisTenants ??= new Map())
  let tenant = tenants.get(id)
  if (!tenant) {
    tenant = load(id)
    tenants.set(id, tenant)
    tenant.catch(() => tenants.delete(id))
  }
  return tenant
}
