import { DurableObject } from "cloudflare:workers";

/** One per counter, addressed by the UUID stored in the registry. Holds nothing but the count. */
export class Counter extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS counter (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0
      );
      INSERT OR IGNORE INTO counter (id, count, updated_at) VALUES (1, 0, 0);
    `);
  }

  /** Atomic ±1. Clamped to JavaScript's safe-integer range so the returned number is always exact. */
  adjust(delta: number): number {
    if (delta !== 1 && delta !== -1) throw new Error("Invalid counter delta");
    return this.ctx.storage.sql.exec<{ count: number }>(
      "UPDATE counter SET count = MAX(?, MIN(?, count + ?)), updated_at = ? WHERE id = 1 RETURNING count",
      Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, delta, Date.now(),
    ).one().count;
  }

  getCount(): number {
    return this.ctx.storage.sql.exec<{ count: number }>("SELECT count FROM counter WHERE id = 1").one().count;
  }

  reset(): void {
    this.ctx.storage.sql.exec("UPDATE counter SET count = 0, updated_at = ? WHERE id = 1", Date.now());
  }
}
