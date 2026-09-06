import { env, exports } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext, runInDurableObject } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import { InteractionResponseType, InteractionType, MessageFlags } from "discord-api-types/v10";
import type { APIInteractionResponseCallbackData } from "discord-api-types/v10";
import worker from "../src/index";
import { MSG } from "../src/messages";
import { TEST_PUBLIC_KEY_HEX } from "./fixtures/keys";
import { makeButtonInteraction, makeCommandInteraction, signInteraction } from "./helpers";
type ResponseBody = { type: InteractionResponseType; data: APIInteractionResponseCallbackData };
async function send(payload: unknown) {
  const signed = await signInteraction(JSON.stringify(payload));
  const response = await exports.default.fetch("https://example.com/interactions", { method: "POST", ...signed });
  expect(response.status).toBe(200);
  const result = await response.json() as ResponseBody;
  if (result.data) expect(result.data.allowed_mentions).toEqual({ parse: [] });
  return result;
}
const command = (scope: string | null, name: string, options: Record<string, string> = {}, userId = "100") => send(makeCommandInteraction(name, options, scope, userId));
function buttons(response: ResponseBody): string[] {
  const row = response.data.components?.[0];
  if (!row || !("components" in row)) throw new Error("Expected action row");
  return row.components.map(button => { if (!("custom_id" in button)) throw new Error("Expected custom ID"); return button.custom_id; });
}
afterEach(() => vi.restoreAllMocks());
it("routes health, root, unknown paths, and methods", async () => {
  expect(await (await exports.default.fetch("https://example.com/healthz")).text()).toBe("ok");
  expect(await (await exports.default.fetch("https://example.com/")).text()).toContain("Aeolipyle");
  expect((await exports.default.fetch("https://example.com/missing")).status).toBe(404);
  const wrong = await exports.default.fetch("https://example.com/interactions");
  expect(wrong.status).toBe(405); expect(wrong.headers.get("Allow")).toBe("POST");
});
it("verifies signed PING and rejects absent, invalid, and modified signatures", async () => {
  expect((await send({ type: InteractionType.Ping })).type).toBe(InteractionResponseType.Pong);
  expect((await exports.default.fetch("https://example.com/interactions", { method: "POST", body: "{}" })).status).toBe(401);
  const signed = await signInteraction('{"type":1}');
  for (const signature of ["bad", "0".repeat(128)]) {
    expect((await exports.default.fetch("https://example.com/interactions", { method: "POST", ...signed, headers: { ...signed.headers, "X-Signature-Ed25519": signature } })).status).toBe(401);
  }
  expect((await exports.default.fetch("https://example.com/interactions", { method: "POST", ...signed, body: '{"type":2}' })).status).toBe(401);
  for (const body of ["{", "null", "42", "{}"]) {
    const malformed = await signInteraction(body);
    expect((await exports.default.fetch("https://example.com/interactions", { method: "POST", ...malformed })).status).toBe(400);
  }
});
it("runs all seven commands publicly or ephemerally as specified", async () => {
  const scope = crypto.randomUUID();
  const created = await command(scope, "addcounter", { name: "Foo Bar", description: "@everyone description" });
  expect(created.data.flags).toBeUndefined(); expect(created.data.content).toContain("📝 @everyone description");
  expect((await command(scope, "addcounter", { name: "foo bar" })).data.flags).toBe(MessageFlags.Ephemeral);
  expect((await command(scope, "increment", { name: "FOO BAR" })).data.content).toContain("**1**");
  expect((await command(scope, "increment", { name: "foo bar" })).data.content).toContain("**2**");
  expect((await command(scope, "decrement", { name: "foo bar" })).data.content).toContain("**1**");
  expect((await command(scope, "counter", { name: "foo bar" })).data.content).toContain("📝 @everyone description");
  expect((await command(scope, "renamecounter", { name: "foo bar", new_name: "Baz Qux" })).data.content).toContain("**Foo Bar** → **Baz Qux**");
  const listed = await command(scope, "counters");
  expect(listed.data.flags).toBe(MessageFlags.Ephemeral); expect(listed.data.embeds?.[0]?.description).toContain("**Baz Qux** · 1");
  expect((await command(scope, "removecounter", { name: "baz qux" })).data.content).toContain("it was at **1**");
  expect((await command(scope, "counter", { name: "baz qux" })).data.flags).toBe(MessageFlags.Ephemeral);
  expect((await command(scope, "counters")).data.content).toBe(MSG.noCounters);
});
it("supports optional descriptions and isolates guilds and bot DM users", async () => {
  const scope = crypto.randomUUID(); const userId = crypto.randomUUID();
  expect((await command(scope, "addcounter", { name: "Foo" })).data.content).not.toContain("📝");
  expect((await command(scope, "counter", { name: "Foo" })).data.content).not.toContain("📝");
  expect((await command(scope, "addcounter", { name: "White", description: "  " })).data.content).not.toContain("📝");
  expect((await command(null, "addcounter", { name: "Foo" }, userId)).data.flags).toBeUndefined();
  expect((await command(null, "increment", { name: "Foo" }, userId)).data.content).toContain("**1**");
  expect((await command(null, "counter", { name: "Foo" }, "different-user")).data.content).toBe(MSG.notFound("Foo"));
  expect((await command(scope, "counter", { name: "Foo" })).data.content).toContain("**0**");
  expect((await command(crypto.randomUUID(), "counter", { name: "Foo" })).data.content).toBe(MSG.notFound("Foo"));
});
it("returns validation and dispatch errors ephemerally", async () => {
  const scope = crypto.randomUUID();
  expect((await command(scope, "addcounter", { name: "bad_name" })).data.content).toBe(MSG.badName);
  expect((await command(scope, "renamecounter", { name: "ok", new_name: "bad_name" })).data.content).toBe(MSG.badName);
  expect((await command(scope, "addcounter", { name: "Foo", description: "x".repeat(501) })).data.content).toBe(MSG.badDescription);
  expect((await command(scope, "unrecognized")).data.content).toBe(MSG.unknownCommand);
  expect((await send({ ...makeCommandInteraction("counter"), type: InteractionType.ApplicationCommandAutocomplete })).data.content).toBe(MSG.unsupported);
  expect((await send(makeButtonInteraction("bad"))).data.content).toBe(MSG.staleButton);
});
it.each(["keep", "zero"] as const)("restores with %s publicly and cleans the original prompt", async mode => {
  const scope = crypto.randomUUID();
  await command(scope, "addcounter", { name: "Foo Bar", description: "old" });
  await command(scope, "increment", { name: "Foo Bar" });
  await command(scope, "removecounter", { name: "Foo Bar" });
  const prompt = await command(scope, "addcounter", { name: "FOO BAR", description: "new" });
  expect(prompt.data.flags).toBe(MessageFlags.Ephemeral); expect(buttons(prompt)).toHaveLength(3);
  const id = buttons(prompt)[mode === "zero" ? 0 : 1]!;
  const mock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
  // Direct invocation lets us await the background cleanup deterministically.
  const ctx = createExecutionContext();
  const signed = await signInteraction(JSON.stringify(makeButtonInteraction(id, scope)));
  const response = await worker.fetch(new Request("https://example.com/interactions", { method: "POST", ...signed }), { ...env, DISCORD_PUBLIC_KEY: TEST_PUBLIC_KEY_HEX }, ctx);
  const restored = await response.json() as ResponseBody;
  await waitOnExecutionContext(ctx);
  expect(restored.type).toBe(InteractionResponseType.ChannelMessageWithSource);
  expect(restored.data.flags).toBeUndefined();
  expect(restored.data.content).toContain(`**${mode === "zero" ? 0 : 1}**`);
  expect(mock).toHaveBeenCalledWith("https://discord.com/api/v10/webhooks/1546275044819345408/test-interaction-token/messages/%40original", expect.objectContaining({ method: "PATCH" }));
  const body = JSON.parse(String(mock.mock.calls[0]?.[1]?.body)) as { allowed_mentions: unknown; components: unknown };
  expect(body.allowed_mentions).toEqual({ parse: [] }); expect(body.components).toEqual([]);
  mock.mockRestore();
  expect((await command(scope, "counter", { name: "foo bar" })).data.content).toContain("📝 new");
});
it("cancels, rejects another user, and never resets from a stale sibling prompt", async () => {
  const scope = crypto.randomUUID();
  await command(scope, "addcounter", { name: "Foo" });
  await command(scope, "increment", { name: "Foo" });
  await command(scope, "removecounter", { name: "Foo" });
  const cancelled = buttons(await command(scope, "addcounter", { name: "Foo" }));
  expect((await send(makeButtonInteraction(cancelled[2]!, scope, "other"))).data.content).toBe(MSG.notYourPrompt);
  const cancelResponse = await send(makeButtonInteraction(cancelled[2]!, scope));
  expect(cancelResponse.type).toBe(InteractionResponseType.UpdateMessage);
  expect(cancelResponse.data.content).toBe(MSG.restoreCancelled("Foo"));
  expect(cancelResponse.data.components).toEqual([]);
  const first = buttons(await command(scope, "addcounter", { name: "Foo" }));
  const second = buttons(await command(scope, "addcounter", { name: "Foo" }));
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
  await send(makeButtonInteraction(first[1]!, scope));
  await command(scope, "increment", { name: "Foo" });
  const stale = await send(makeButtonInteraction(second[0]!, scope));
  expect(stale.type).toBe(InteractionResponseType.UpdateMessage);
  expect(stale.data.content).toBe(MSG.restoreExpired);
  expect((await command(scope, "counter", { name: "Foo" })).data.content).toContain("**2**");
});
it("paginates long counter names in embeds and clamps after removals", async () => {
  const scope = crypto.randomUUID(); const registry = env.COUNTER_REGISTRY.getByName(`guild:${scope}`);
  for (let n = 0; n < 45; n++) await registry.create({ displayName: `C${String(n).padStart(2, "0")}${"x".repeat(97)}`, description: null, userId: "100", interactionToken: "test" });
  const first = await command(scope, "counters");
  expect(first.data.embeds?.[0]?.description?.length).toBeGreaterThan(2000);
  expect(first.data.embeds?.[0]?.description?.length).toBeLessThan(4096);
  const next = await send(makeButtonInteraction(buttons(first)[1]!, scope));
  expect(next.type).toBe(InteractionResponseType.UpdateMessage);
  expect(next.data.embeds?.[0]?.footer?.text).toBe("Page 2/3 · 45 counters");
  await runInDurableObject(registry, (_i, s) => { s.storage.sql.exec("UPDATE counters SET deleted_at = 1"); });
  const empty = await send(makeButtonInteraction("ctrs:page:99", scope));
  expect(empty.data.content).toBe(MSG.noCounters); expect(empty.data.embeds).toEqual([]); expect(empty.data.components).toEqual([]);
});
