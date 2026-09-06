import { verifyKey } from "discord-interactions";
export async function verifyDiscordRequest(request: Request, publicKey: string): Promise<{ ok: true; body: string } | { ok: false }> {
  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");
  if (!signature || !timestamp || !/^[a-fA-F0-9]{128}$/.test(signature)) return { ok: false };
  const body = await request.text();
  try {
    return await verifyKey(body, signature, timestamp, publicKey) ? { ok: true, body } : { ok: false };
  } catch {
    return { ok: false };
  }
}
