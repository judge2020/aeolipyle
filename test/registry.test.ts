import { env } from "cloudflare:workers";
import { runInDurableObject, evictDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { RESTORE_CLAIM_TTL_MS } from "../src/durable-objects/CounterRegistry";
const fresh = () => env.COUNTER_REGISTRY.getByName(crypto.randomUUID());
const input = (displayName = "Foo", description: string | null = "old description") => ({ displayName, description, userId: "100", interactionToken: "test-token" });
async function deleted(r: ReturnType<typeof fresh>) {
  await r.create(input());
  await r.remove("foo", "100");
  const result = await r.create(input("FOO", "new description"));
  if (result.status !== "deleted") throw new Error("Expected restore prompt");
  return result;
}
it("creates, preserves null descriptions, and rejects case-insensitive duplicates", async () => {
  const r = fresh();
  expect((await r.create(input("Foo Bar", null))).status).toBe("created");
  expect((await r.create(input("foo bar"))).status).toBe("exists");
  expect((await r.lookup("FOO BAR"))?.description).toBeNull();
  await evictDurableObject(r);
  expect((await r.lookup("foo bar"))?.displayName).toBe("Foo Bar");
});
it("claims exclusively, consumes all prompts, and applies restore metadata", async () => {
  const r = fresh(); const p = await deleted(r);
  const p2 = await r.create(input());
  if (p2.status !== "deleted") throw new Error("Expected prompt");
  expect(await r.claimRestore(p.restoreToken, "other")).toEqual({ status: "forbidden" });
  expect((await r.claimRestore(p.restoreToken, "100")).status).toBe("claimed");
  expect(await r.claimRestore(p.restoreToken, "100")).toEqual({ status: "unknown" });
  expect(await r.claimRestore(p2.restoreToken, "100")).toEqual({ status: "unknown" });
  expect((await r.create(input())).status).toBe("busy");
  expect(await r.lookup("foo")).toBeNull();
  const restored = await r.finalizeRestore(p.restoreToken, { displayName: "FOO", description: "new description" });
  expect(restored.status).toBe("restored");
  expect(await r.lookup("foo")).toMatchObject({ displayName: "FOO", description: "new description", counterId: p.counter.counterId });
  expect(await r.finalizeRestore(p.restoreToken, { displayName: "FOO", description: null })).toEqual({ status: "lost_claim" });
});
it("preserves the old description when restoring without one", async () => {
  const r = fresh(); const p = await deleted(r);
  await r.claimRestore(p.restoreToken, "100");
  await r.finalizeRestore(p.restoreToken, { displayName: "Foo", description: null });
  expect((await r.lookup("foo"))?.description).toBe("old description");
});
it("releases failed claims and allows another restore attempt", async () => {
  const r = fresh(); const p = await deleted(r);
  await r.claimRestore(p.restoreToken, "100");
  await r.releaseRestoreClaim(p.restoreToken);
  expect((await r.create(input())).status).toBe("deleted");
});
it("expires prompts and cancels only for their owner", async () => {
  const r = fresh(); const p = await deleted(r);
  expect(await r.cancelPendingRestore(p.restoreToken, "other")).toEqual({ status: "forbidden" });
  expect(await r.cancelPendingRestore(p.restoreToken, "100")).toEqual({ status: "cancelled", displayName: "Foo" });
  expect(await r.cancelPendingRestore(p.restoreToken, "100")).toEqual({ status: "unknown" });
  const p2 = await r.create(input()); if (p2.status !== "deleted") throw new Error("Expected prompt");
  await runInDurableObject(r, (_i, s) => { s.storage.sql.exec("UPDATE pending_restores SET expires_at = 0"); });
  expect(await r.claimRestore(p2.restoreToken, "100")).toEqual({ status: "expired" });
});
it("rejects old generations and already active counters, including reused names", async () => {
  for (const mode of ["active", "generation", "reused"] as const) {
    const r = fresh(); const p = await deleted(r);
    // Seed a leftover prompt to exercise defensive guards beyond sibling deletion.
    await runInDurableObject(r, (_i, s) => {
      if (mode === "active") s.storage.sql.exec("UPDATE counters SET deleted_at = NULL");
      if (mode === "generation") s.storage.sql.exec("UPDATE counters SET deleted_generation = deleted_generation + 1");
      if (mode === "reused") s.storage.sql.exec("UPDATE counters SET deleted_at = NULL, name_key = 'renamed', display_name = 'Renamed'");
    });
    if (mode === "reused") await r.create(input());
    expect(await r.claimRestore(p.restoreToken, "100")).toEqual({ status: "stale" });
    if (mode === "reused") expect((await r.lookup("foo"))?.counterId).not.toBe(p.counter.counterId);
  }
});
it("rejects competing live claims, reclaims expired ones, and fences old finalization", async () => {
  const r = fresh(); const p = await deleted(r);
  await runInDurableObject(r, (_i, s) => {
    s.storage.sql.exec("UPDATE counters SET restore_claim = 'old-claim', restore_claim_at = ?", Date.now());
  });
  expect(await r.claimRestore(p.restoreToken, "100")).toEqual({ status: "busy" });
  await runInDurableObject(r, (_i, s) => { s.storage.sql.exec("UPDATE counters SET restore_claim_at = ?", Date.now() - RESTORE_CLAIM_TTL_MS - 1); });
  expect((await r.create(input())).status).toBe("deleted");
  expect((await r.claimRestore(p.restoreToken, "100")).status).toBe("claimed");
  expect(await r.finalizeRestore("old-claim", { displayName: "Foo", description: null })).toEqual({ status: "lost_claim" });
  await runInDurableObject(r, (_i, s) => { s.storage.sql.exec("UPDATE counters SET restore_claim_at = 0"); });
  expect(await r.finalizeRestore(p.restoreToken, { displayName: "Foo", description: null })).toEqual({ status: "lost_claim" });
});
it("renames casing and identity, blocks occupied and deleted targets", async () => {
  const r = fresh(); await r.create(input()); const original = await r.lookup("foo");
  expect((await r.rename("foo", "FOO")).status).toBe("renamed");
  expect((await r.lookup("foo"))?.displayName).toBe("FOO");
  await r.create(input("Bar"));
  expect((await r.rename("foo", "Bar")).status).toBe("target_exists");
  await r.remove("bar", "100");
  expect((await r.rename("foo", "Bar")).status).toBe("target_deleted");
  expect((await r.rename("foo", "Baz")).status).toBe("renamed");
  expect((await r.lookup("baz"))?.counterId).toBe(original?.counterId);
  expect(await r.lookup("foo")).toBeNull();
  expect((await r.rename("missing", "X")).status).toBe("not_found");
  expect(await r.remove("missing", "100")).toBeNull();
});
it("lists 45 active counters in sorted clamped pages", async () => {
  const r = fresh();
  for (let n = 44; n >= 0; n--) await r.create(input(`C${String(n).padStart(2, "0")}`));
  expect(await r.list(-1)).toMatchObject({ total: 45, page: 0, pageCount: 3 });
  expect((await r.list(0)).items.map(c => c.displayName)).toEqual(Array.from({ length: 20 }, (_, n) => `C${String(n).padStart(2, "0")}`));
  expect((await r.list(1)).items).toHaveLength(20);
  expect(await r.list(999)).toMatchObject({ page: 2 });
  expect((await r.list(999)).items).toHaveLength(5);
  await r.remove("c00", "100");
  expect((await r.list(0)).items[0]?.displayName).toBe("C01");
});
