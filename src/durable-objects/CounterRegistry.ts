import { DurableObject } from "cloudflare:workers";
import { nameKey, validateCounterName } from "../lib/names";

export const PENDING_TTL_MS = 15 * 60_000;
export const RESTORE_CLAIM_TTL_MS = 60_000;
export type CounterRecord = {
  nameKey: string; displayName: string; description: string | null; counterId: string;
  createdAt: number; createdBy: string; deletedAt: number | null; deletedGeneration: number;
};
type Row = {
  name_key: string; display_name: string; description: string | null; counter_id: string;
  created_at: number; created_by: string; deleted_at: number | null; deleted_by: string | null;
  deleted_generation: number; restore_claim: string | null; restore_claim_at: number | null;
};
type Pending = {
  token: string; counter_id: string; deleted_generation: number; new_display_name: string;
  new_description: string | null; requested_by: string; interaction_token: string; expires_at: number;
};
export type CounterPage = { items: CounterRecord[]; total: number; page: number; pageCount: number };
const record = (r: Row): CounterRecord => ({
  nameKey: r.name_key, displayName: r.display_name, description: r.description, counterId: r.counter_id,
  createdAt: r.created_at, createdBy: r.created_by, deletedAt: r.deleted_at, deletedGeneration: r.deleted_generation,
});

export class CounterRegistry extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS counters (
        name_key TEXT PRIMARY KEY, display_name TEXT NOT NULL, description TEXT,
        counter_id TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, created_by TEXT NOT NULL,
        deleted_at INTEGER, deleted_by TEXT, deleted_generation INTEGER NOT NULL DEFAULT 0,
        restore_claim TEXT, restore_claim_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS counters_active ON counters (deleted_at, name_key);
      CREATE TABLE IF NOT EXISTS pending_restores (
        token TEXT PRIMARY KEY, counter_id TEXT NOT NULL, deleted_generation INTEGER NOT NULL,
        new_display_name TEXT NOT NULL, new_description TEXT, requested_by TEXT NOT NULL,
        interaction_token TEXT NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS pending_by_counter ON pending_restores (counter_id);
    `);
  }

  private row(key: string): Row | undefined {
    return this.ctx.storage.sql.exec<Row>("SELECT * FROM counters WHERE name_key = ?", nameKey(key)).toArray()[0];
  }

  private liveClaim(row: Row): boolean {
    return row.restore_claim !== null && (row.restore_claim_at ?? 0) > Date.now() - RESTORE_CLAIM_TTL_MS;
  }

  create(input: { displayName: string; description: string | null; userId: string; interactionToken: string }) {
    const valid = validateCounterName(input.displayName);
    if (!valid.ok || valid.display !== input.displayName || (input.description !== null && [...input.description].length > 500)) {
      throw new Error("Invalid counter metadata");
    }
    return this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      sql.exec("DELETE FROM pending_restores WHERE expires_at <= ?", Date.now());
      const existing = this.row(valid.key);
      if (existing) {
        const counter = record(existing);
        if (existing.deleted_at === null) return { status: "exists" as const, counter };
        if (this.liveClaim(existing)) return { status: "busy" as const, counter };
        const restoreToken = crypto.randomUUID();
        sql.exec("INSERT INTO pending_restores VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          restoreToken, existing.counter_id, existing.deleted_generation, input.displayName,
          input.description, input.userId, input.interactionToken, Date.now() + PENDING_TTL_MS);
        return { status: "deleted" as const, counter, restoreToken };
      }
      const r = sql.exec<Row>(
        "INSERT INTO counters (name_key, display_name, description, counter_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING *",
        valid.key, input.displayName, input.description, crypto.randomUUID(), Date.now(), input.userId,
      ).one();
      return { status: "created" as const, counter: record(r) };
    });
  }

  lookup(key: string): CounterRecord | null {
    const r = this.row(key);
    return r && r.deleted_at === null ? record(r) : null;
  }

  list(requestedPage: number, pageSize = 20): CounterPage {
    const size = Math.max(1, Math.min(20, Number.isSafeInteger(pageSize) ? pageSize : 20));
    const total = this.ctx.storage.sql.exec<{ total: number }>("SELECT COUNT(*) AS total FROM counters WHERE deleted_at IS NULL").one().total;
    const pageCount = Math.max(1, Math.ceil(total / size));
    const page = Math.max(0, Math.min(pageCount - 1, Number.isSafeInteger(requestedPage) ? requestedPage : 0));
    const items = this.ctx.storage.sql.exec<Row>(
      "SELECT * FROM counters WHERE deleted_at IS NULL ORDER BY name_key LIMIT ? OFFSET ?", size, page * size,
    ).toArray().map(record);
    return { items, total, page, pageCount };
  }

  remove(key: string, userId: string): CounterRecord | null {
    const r = this.ctx.storage.sql.exec<Row>(
      `UPDATE counters SET deleted_at = ?, deleted_by = ?, deleted_generation = deleted_generation + 1,
       restore_claim = NULL, restore_claim_at = NULL WHERE name_key = ? AND deleted_at IS NULL RETURNING *`,
      Date.now(), userId, nameKey(key),
    ).toArray()[0];
    return r ? record(r) : null;
  }

  rename(key: string, newDisplayName: string) {
    if (!validateCounterName(newDisplayName).ok) throw new Error("Invalid counter name");
    return this.ctx.storage.transactionSync(() => {
      const before = this.lookup(key);
      if (!before) return { status: "not_found" as const };
      const newKey = nameKey(newDisplayName);
      const target = this.row(newKey);
      if (newKey !== before.nameKey && target) {
        return { status: target.deleted_at === null ? "target_exists" as const : "target_deleted" as const, target: record(target) };
      }
      const after = this.ctx.storage.sql.exec<Row>(
        "UPDATE counters SET name_key = ?, display_name = ? WHERE name_key = ? RETURNING *", newKey, newDisplayName, before.nameKey,
      ).one();
      return { status: "renamed" as const, before, after: record(after) };
    });
  }

  claimRestore(token: string, userId: string) {
    return this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      const p = sql.exec<Pending>("SELECT * FROM pending_restores WHERE token = ?", token).toArray()[0];
      if (!p) return { status: "unknown" as const };
      // Check ownership before allowing a request to invalidate someone else's prompt.
      if (p.requested_by !== userId) return { status: "forbidden" as const };
      if (p.expires_at <= Date.now()) {
        sql.exec("DELETE FROM pending_restores WHERE token = ?", token);
        return { status: "expired" as const };
      }
      const r = sql.exec<Row>("SELECT * FROM counters WHERE counter_id = ?", p.counter_id).toArray()[0];
      if (!r || r.deleted_at === null || r.deleted_generation !== p.deleted_generation) {
        sql.exec("DELETE FROM pending_restores WHERE token = ?", token);
        return { status: "stale" as const };
      }
      if (this.liveClaim(r) && r.restore_claim !== token) return { status: "busy" as const };
      sql.exec("UPDATE counters SET restore_claim = ?, restore_claim_at = ? WHERE counter_id = ?", token, Date.now(), r.counter_id);
      // Consume all sibling prompts before allowing any reset on the counter object.
      sql.exec("DELETE FROM pending_restores WHERE counter_id = ?", r.counter_id);
      return { status: "claimed" as const, pending: {
        counterId: r.counter_id, nameKey: r.name_key, newDisplayName: p.new_display_name,
        newDescription: p.new_description, interactionToken: p.interaction_token,
      } };
    });
  }

  finalizeRestore(token: string, input: { displayName: string; description: string | null }) {
    const r = this.ctx.storage.sql.exec<Row>(
      `UPDATE counters SET deleted_at = NULL, deleted_by = NULL, display_name = ?,
       description = COALESCE(?, description), restore_claim = NULL, restore_claim_at = NULL
       WHERE restore_claim = ? AND deleted_at IS NOT NULL AND name_key = lower(?)
       AND restore_claim_at > ? RETURNING *`,
      input.displayName, input.description, token, input.displayName, Date.now() - RESTORE_CLAIM_TTL_MS,
    ).toArray()[0];
    return r ? { status: "restored" as const, counter: record(r) } : { status: "lost_claim" as const };
  }

  releaseRestoreClaim(token: string): void {
    this.ctx.storage.sql.exec("UPDATE counters SET restore_claim = NULL, restore_claim_at = NULL WHERE restore_claim = ?", token);
  }

  cancelPendingRestore(token: string, userId: string) {
    return this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      const p = sql.exec<Pending>("SELECT * FROM pending_restores WHERE token = ?", token).toArray()[0];
      if (!p) return { status: "unknown" as const };
      if (p.requested_by !== userId) return { status: "forbidden" as const };
      sql.exec("DELETE FROM pending_restores WHERE token = ?", token);
      if (p.expires_at <= Date.now()) return { status: "expired" as const };
      const r = sql.exec<Row>("SELECT * FROM counters WHERE counter_id = ?", p.counter_id).toArray()[0];
      return r ? { status: "cancelled" as const, displayName: r.display_name } : { status: "unknown" as const };
    });
  }
}
