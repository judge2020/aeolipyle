import { expect, it } from "vitest";
import { validateCounterName } from "../src/lib/names";
import { parseCustomId, restoreId, cancelId, pageId } from "../src/components/customId";
it.each(["a", "Foo123", "a".repeat(100)])("accepts %s", name => expect(validateCounterName(name)).toEqual({ ok: true, display: name, key: name.toLowerCase() }));
it.each(["", " ", "a".repeat(101), "a b", "a-b", "a_b", "é", "猫", "a\nb"])("rejects %s", name => expect(validateCounterName(name)).toEqual({ ok: false }));
it("trims names without losing display casing", () => expect(validateCounterName(" Foo ")).toEqual({ ok: true, display: "Foo", key: "foo" }));
it("round trips custom IDs within Discord's limit", () => {
  const token = crypto.randomUUID();
  expect(parseCustomId(restoreId("zero", token))).toEqual({ kind: "restore", mode: "zero", token });
  expect(parseCustomId(restoreId("keep", token))).toEqual({ kind: "restore", mode: "keep", token });
  expect(parseCustomId(cancelId(token))).toEqual({ kind: "cancel", token });
  expect(parseCustomId(pageId(3))).toEqual({ kind: "page", page: 3 });
  expect(restoreId("zero", token).length).toBeLessThanOrEqual(100);
});
it.each(["ctrs:page:-1", "ctrs:page:1.1", "ctrs:page:1:extra", "ctrs:page:9007199254740992", "addc:restore:zero:no", "x".repeat(101)])("rejects malformed button %s", id => expect(parseCustomId(id)).toBeNull());
