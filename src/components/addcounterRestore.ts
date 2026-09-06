import type { APIMessageComponentInteraction, APIInteractionResponse } from "discord-api-types/v10";
import { ephemeral, reply, updateMessage } from "../discord/respond";
import { editOriginalResponse } from "../discord/rest";
import { invokingUser, scopeKeyFor } from "../discord/scope";
import { MSG } from "../messages";
import type { CustomId } from "./customId";
export async function addcounterRestore(interaction: APIMessageComponentInteraction, env: Env, ctx: ExecutionContext, id: Exclude<CustomId, { kind: "page" }>): Promise<APIInteractionResponse> {
  const registry = env.COUNTER_REGISTRY.getByName(scopeKeyFor(interaction));
  const userId = invokingUser(interaction).id;
  if (id.kind === "cancel") {
    const res = await registry.cancelPendingRestore(id.token, userId);
    if (res.status === "forbidden") return ephemeral(MSG.notYourPrompt);
    return updateMessage(res.status === "cancelled" ? MSG.restoreCancelled(res.displayName) : MSG.restoreExpired);
  }
  const res = await registry.claimRestore(id.token, userId);
  if (res.status === "forbidden") return ephemeral(MSG.notYourPrompt);
  if (res.status === "busy") return ephemeral(MSG.restoreBusy);
  if (res.status !== "claimed") return updateMessage(MSG.restoreExpired);
  const { pending } = res;
  const counter = env.COUNTER.getByName(pending.counterId);
  if (id.mode === "zero") {
    try { await counter.reset(); }
    catch {
      await registry.releaseRestoreClaim(id.token).catch(() => undefined);
      return ephemeral(MSG.internalError);
    }
  }
  const restored = await registry.finalizeRestore(id.token, { displayName: pending.newDisplayName, description: pending.newDescription });
  if (restored.status !== "restored") return updateMessage(MSG.restoreExpired);
  const count = id.mode === "zero" ? 0 : await counter.getCount();
  ctx.waitUntil(editOriginalResponse(env, pending.interactionToken, { content: MSG.restorePromptDone(restored.counter.displayName), components: [] }).catch(() => {
    console.warn({ event: "restore_prompt_cleanup_failed" });
  }));
  return reply(MSG.restored(restored.counter.displayName, id.mode, count));
}
