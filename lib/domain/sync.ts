import type { DemoData } from "@/lib/types"

type Keyed = { id: string }

export interface CollectionChange {
  upsert?: Keyed[]
  remove?: string[]
  /** Full id order, sent only when items were added so every device keeps the server's order. */
  order?: string[]
}

/** What one server change did to the tenant's data: entity upserts per collection, and whole values for everything else. */
export interface Changes {
  collections?: Record<string, CollectionChange>
  values?: Partial<Record<keyof DemoData, unknown>>
}

const isKeyedArray = (value: unknown): value is Keyed[] => Array.isArray(value)

/** Diffs by reference, which is exact on the server because commands copy only what they change. */
export function diffData(before: DemoData, after: DemoData): Changes {
  const collections: Record<string, CollectionChange> = {}
  const values: Partial<Record<keyof DemoData, unknown>> = {}
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]) as Set<keyof DemoData>
  for (const key of keys) {
    const prev = before[key] as unknown
    const next = after[key] as unknown
    if (prev === next) continue
    if (isKeyedArray(next) && (prev === undefined || isKeyedArray(prev))) {
      const old = new Map((prev ?? []).map((item) => [item.id, item]))
      const upsert = next.filter((item) => old.get(item.id) !== item)
      const ids = new Set(next.map((item) => item.id))
      const remove = [...old.keys()].filter((id) => !ids.has(id))
      const added = upsert.some((item) => !old.has(item.id))
      if (!upsert.length && !remove.length) continue
      collections[key] = {
        ...(upsert.length ? { upsert } : {}),
        ...(remove.length ? { remove } : {}),
        ...(added ? { order: next.map((item) => item.id) } : {}),
      }
      continue
    }
    values[key] = next
  }
  return {
    ...(Object.keys(collections).length ? { collections } : {}),
    ...(Object.keys(values).length ? { values } : {}),
  }
}

export const isEmptyChange = (changes: Changes) => !changes.collections && !changes.values

export function applyChanges(data: DemoData, changes: Changes): DemoData {
  const next = { ...data } as Record<string, unknown>
  for (const [key, change] of Object.entries(changes.collections ?? {})) {
    const existing = (next[key] as Keyed[] | undefined) ?? []
    const upserts = new Map((change.upsert ?? []).map((item) => [item.id, item]))
    const removed = new Set(change.remove ?? [])
    if (change.order) {
      const current = new Map(existing.map((item) => [item.id, item]))
      next[key] = change.order.flatMap((id) => {
        const item = upserts.get(id) ?? current.get(id)
        return item && !removed.has(id) ? [item] : []
      })
    } else {
      next[key] = existing.filter((item) => !removed.has(item.id)).map((item) => upserts.get(item.id) ?? item)
    }
  }
  for (const [key, value] of Object.entries(changes.values ?? {})) next[key] = value
  return next as unknown as DemoData
}
