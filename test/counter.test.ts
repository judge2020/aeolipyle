import { env } from "cloudflare:workers";
import { runInDurableObject, evictDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
const fresh = () => env.COUNTER.getByName(crypto.randomUUID());
it("increments, decrements below zero, and resets", async () => {
  const c = fresh();
  expect(await c.getCount()).toBe(0);
  for (let i = 1; i <= 3; i++) expect(await c.adjust(1)).toBe(i);
  await c.reset();
  expect(await c.adjust(-1)).toBe(-1);
  await c.reset();
  expect(await c.getCount()).toBe(0);
  await runInDurableObject(c, instance => { expect(() => instance.adjust(2)).toThrow("Invalid counter delta"); });
});
it("serializes 100 concurrent increments with exact distinct results", async () => {
  const c = fresh();
  const counts = await Promise.all(Array.from({ length: 100 }, () => c.adjust(1)));
  expect(await c.getCount()).toBe(100);
  expect(counts.sort((a, b) => a - b)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
});
it.each([1, -1])("clamps the safe integer bound in direction %s", async delta => {
  const c = fresh();
  await runInDurableObject(c, (_instance, state) => { state.storage.sql.exec("UPDATE counter SET count = ? WHERE id = 1", delta * Number.MAX_SAFE_INTEGER); });
  expect(await c.adjust(delta)).toBe(delta * Number.MAX_SAFE_INTEGER);
  expect(await c.adjust(-delta)).toBe(delta * (Number.MAX_SAFE_INTEGER - 1));
});
it("persists the value across object eviction", async () => {
  const c = fresh();
  await c.adjust(1);
  await evictDurableObject(c);
  expect(await c.getCount()).toBe(1);
});
