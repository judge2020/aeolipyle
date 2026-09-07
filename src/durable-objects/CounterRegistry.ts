import { DurableObject } from "cloudflare:workers";
import { MAX_DESCRIPTION_LENGTH } from "../lib/limits";
import { nameKey, validateCounterName } from "../lib/names";

/** Lifetime of a restore prompt's buttons; matches Discord's interaction-token lifetime. */
export const PENDING_TTL_MS = 15 * 60_000;
/** How long an in-flight restore holds exclusive access to a soft-deleted counter. */
export const RESTORE_CLAIM_TTL_MS = 60_000;

export type CounterRecord = {
  nameKey: string;
  displayName: string;
  description: string | null;
  counterId: string;
  createdAt: number;
  createdBy: string;
  deletedAt: number | null;
  deletedGeneration: number;
};

export type CounterPage = { items: CounterRecord[]; total: number; page: number; pageCount: number };

type CounterRow = {
  name_key: string;
  display_name: string;
  description: string | null;
  counter_id: string;
  created_at: number;
  created_by: string;
  deleted_at: number | null;
  deleted_by: string | null;
  deleted_generation: number;
  restore_claim: string | null;
  restore_claim_at: number | null;
};

type PendingRow = {
  token: string;
  counter_id: string;
  deleted_generation: number;
  new_display_name: string;
  new_description: string | null;
  requested_by: string;
  interaction_token: string;
  expires_at: number;
};

const toRecord = (row: CounterRow): CounterRecord => ({
  nameKey: row.name_key,
  displayName: row.display_name,
  description: row.description,
  counterId: row.counter_id,
  createdAt: row.created_at,
  createdBy: row.created_by,
  deletedAt: row.deleted_at,
  deletedGeneration: row.deleted_generation,
});

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS counters (
    name_key           TEXT PRIMARY KEY,           -- lowercase identity; changes only via rename
    display_name       TEXT NOT NULL,              -- casing as last set by add/rename/restore
    description        TEXT,                       -- NULL = no description
    counter_id         TEXT NOT NULL UNIQUE,       -- Counter DO name; immutable
    created_at         INTEGER NOT NULL,           -- epoch ms
    created_by         TEXT NOT NULL,              -- user id
    deleted_at         INTEGER,                    -- NULL = active
    deleted_by         TEXT,
    deleted_generation INTEGER NOT NULL DEFAULT 0, -- +1 on every soft delete
    restore_claim      TEXT,                       -- token of an in-flight restore, else NULL
    restore_claim_at   INTEGER                     -- epoch ms the claim was taken
  );
  CREATE INDEX IF NOT EXISTS counters_active ON counters (deleted_at, name_key);
  CREATE TABLE IF NOT EXISTS pending_restores (
    token              TEXT PRIMARY KEY,           -- goes into button custom_ids
    counter_id         TEXT NOT NULL,              -- immutable target; never resolved by name
    deleted_generation INTEGER NOT NULL,           -- must still equal counters.deleted_generation
    new_display_name   TEXT NOT NULL,
    new_description    TEXT,                       -- NULL = keep the existing description
    requested_by       TEXT NOT NULL,              -- user id that ran /addcounter
    interaction_token  TEXT NOT NULL,              -- slash-command token, to tidy the prompt later
    expires_at         INTEGER NOT NULL            -- epoch ms
  );
  CREATE INDEX IF NOT EXISTS pending_by_counter ON pending_restores (counter_id);
`;

/**
 * One per scope (guild, or user for bot DMs). Owns the name index: case-insensitive uniqueness,
 * soft delete, rename, listing, and the restore-prompt protocol. Counts live in Counter objects.
 */
export class CounterRegistry extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(SCHEMA);
  }

  private rowByKey(key: string): CounterRow | undefined {
    return this.ctx.storage.sql.exec<CounterRow>("SELECT * FROM counters WHERE name_key = ?", nameKey(key)).toArray()[0];
  }

  private rowById(counterId: string): CounterRow | undefined {
    return this.ctx.storage.sql.exec<CounterRow>("SELECT * FROM counters WHERE counter_id = ?", counterId).toArray()[0];
  }

  private pendingByToken(token: string): PendingRow | undefined {
    return this.ctx.storage.sql.exec<PendingRow>("SELECT * FROM pending_restores WHERE token = ?", token).toArray()[0];
  }

  private hasLiveClaim(row: CounterRow): boolean {
    return row.restore_claim !== null && (row.restore_claim_at ?? 0) > Date.now() - RESTORE_CLAIM_TTL_MS;
  }

  create(input: { displayName: string; description: string | null; userId: string; interactionToken: string }) {
    const valid = validateCounterName(input.displayName);
    const descriptionTooLong = input.description !== null && [...input.description].length > MAX_DESCRIPTION_LENGTH;
    if (!valid.ok || valid.display !== input.displayName || descriptionTooLong) throw new Error("Invalid counter metadata");

    return this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      const now = Date.now();
      sql.exec("DELETE FROM pending_restores WHERE expires_at <= ?", now);

      const existing = this.rowByKey(valid.key);
      if (existing) {
        const counter = toRecord(existing);
        if (existing.deleted_at === null) return { status: "exists" as const, counter };
        if (this.hasLiveClaim(existing)) return { status: "busy" as const, counter };
        // Soft-deleted: park the request as a restore prompt bound to this exact deletion.
        const restoreToken = crypto.randomUUID();
        sql.exec(
          `INSERT INTO pending_restores
             (token, counter_id, deleted_generation, new_display_name, new_description, requested_by, interaction_token, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          restoreToken, existing.counter_id, existing.deleted_generation, input.displayName,
          input.description, input.userId, input.interactionToken, now + PENDING_TTL_MS,
        );
        return { status: "deleted" as const, counter, restoreToken };
      }

      const created = sql.exec<CounterRow>(
        "INSERT INTO counters (name_key, display_name, description, counter_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING *",
        valid.key, input.displayName, input.description, crypto.randomUUID(), now, input.userId,
      ).one();
      return { status: "created" as const, counter: toRecord(created) };
    });
  }

  /** Active counters only; soft-deleted ones are invisible here. */
  lookup(key: string): CounterRecord | null {
    const row = this.rowByKey(key);
    return row && row.deleted_at === null ? toRecord(row) : null;
  }

  list(requestedPage: number, pageSize = 20): CounterPage {
    const sql = this.ctx.storage.sql;
    const size = Math.max(1, Math.min(20, Number.isSafeInteger(pageSize) ? pageSize : 20));
    const total = sql.exec<{ total: number }>("SELECT COUNT(*) AS total FROM counters WHERE deleted_at IS NULL").one().total;
    const pageCount = Math.max(1, Math.ceil(total / size));
    const page = Math.max(0, Math.min(pageCount - 1, Number.isSafeInteger(requestedPage) ? requestedPage : 0));
    const items = sql.exec<CounterRow>(
      "SELECT * FROM counters WHERE deleted_at IS NULL ORDER BY name_key LIMIT ? OFFSET ?", size, page * size,
    ).toArray().map(toRecord);
    return { items, total, page, pageCount };
  }

  /** Soft delete. Bumping the generation invalidates every older restore prompt for this counter. */
  remove(key: string, userId: string): CounterRecord | null {
    const row = this.ctx.storage.sql.exec<CounterRow>(
      `UPDATE counters
         SET deleted_at = ?, deleted_by = ?, deleted_generation = deleted_generation + 1, restore_claim = NULL, restore_claim_at = NULL
       WHERE name_key = ? AND deleted_at IS NULL
       RETURNING *`,
      Date.now(), userId, nameKey(key),
    ).toArray()[0];
    return row ? toRecord(row) : null;
  }

  rename(key: string, newDisplayName: string) {
    if (!validateCounterName(newDisplayName).ok) throw new Error("Invalid counter name");
    return this.ctx.storage.transactionSync(() => {
      const before = this.lookup(key);
      if (!before) return { status: "not_found" as const };

      // A casing-only rename keeps the same key; otherwise the new key must be free, even of soft-deleted rows.
      const newKey = nameKey(newDisplayName);
      const target = this.rowByKey(newKey);
      if (newKey !== before.nameKey && target) {
        const status = target.deleted_at === null ? ("target_exists" as const) : ("target_deleted" as const);
        return { status, target: toRecord(target) };
      }

      const after = this.ctx.storage.sql.exec<CounterRow>(
        "UPDATE counters SET name_key = ?, display_name = ? WHERE name_key = ? RETURNING *", newKey, newDisplayName, before.nameKey,
      ).one();
      return { status: "renamed" as const, before, after: toRecord(after) };
    });
  }

  /**
   * Step 1 of a restore: validate the prompt, then take an exclusive claim on the still-soft-deleted row
   * and consume every competing prompt for it. Nothing about the counter changes yet.
   */
  claimRestore(token: string, userId: string) {
    return this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      const pending = this.pendingByToken(token);
      if (!pending) return { status: "unknown" as const };
      // Ownership first, so a stranger's click can never invalidate someone else's prompt.
      if (pending.requested_by !== userId) return { status: "forbidden" as const };
      if (pending.expires_at <= Date.now()) {
        sql.exec("DELETE FROM pending_restores WHERE token = ?", token);
        return { status: "expired" as const };
      }

      const row = this.rowById(pending.counter_id);
      const stale = !row || row.deleted_at === null || row.deleted_generation !== pending.deleted_generation;
      if (stale) {
        sql.exec("DELETE FROM pending_restores WHERE token = ?", token);
        return { status: "stale" as const };
      }
      if (this.hasLiveClaim(row) && row.restore_claim !== token) return { status: "busy" as const };

      sql.exec("UPDATE counters SET restore_claim = ?, restore_claim_at = ? WHERE counter_id = ?", token, Date.now(), row.counter_id);
      sql.exec("DELETE FROM pending_restores WHERE counter_id = ?", row.counter_id);
      return {
        status: "claimed" as const,
        pending: {
          counterId: row.counter_id,
          nameKey: row.name_key,
          newDisplayName: pending.new_display_name,
          newDescription: pending.new_description,
          interactionToken: pending.interaction_token,
        },
      };
    });
  }

  /** Step 2 of a restore: activate the row, but only while this token still holds a live claim. */
  finalizeRestore(token: string, input: { displayName: string; description: string | null }) {
    const row = this.ctx.storage.sql.exec<CounterRow>(
      `UPDATE counters
         SET deleted_at = NULL, deleted_by = NULL, display_name = ?, description = COALESCE(?, description),
             restore_claim = NULL, restore_claim_at = NULL
       WHERE restore_claim = ? AND deleted_at IS NOT NULL AND name_key = lower(?) AND restore_claim_at > ?
       RETURNING *`,
      input.displayName, input.description, token, input.displayName, Date.now() - RESTORE_CLAIM_TTL_MS,
    ).toArray()[0];
    return row ? { status: "restored" as const, counter: toRecord(row) } : { status: "lost_claim" as const };
  }

  /** Lets a failed reset step retry immediately instead of waiting out the claim TTL. */
  releaseRestoreClaim(token: string): void {
    this.ctx.storage.sql.exec("UPDATE counters SET restore_claim = NULL, restore_claim_at = NULL WHERE restore_claim = ?", token);
  }

  cancelPendingRestore(token: string, userId: string) {
    return this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      const pending = this.pendingByToken(token);
      if (!pending) return { status: "unknown" as const };
      if (pending.requested_by !== userId) return { status: "forbidden" as const };
      sql.exec("DELETE FROM pending_restores WHERE token = ?", token);
      if (pending.expires_at <= Date.now()) return { status: "expired" as const };
      const row = this.rowById(pending.counter_id);
      return row ? { status: "cancelled" as const, displayName: row.display_name } : { status: "unknown" as const };
    });
  }
}
