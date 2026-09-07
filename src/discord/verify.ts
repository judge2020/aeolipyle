import { verifyKey } from "discord-interactions";

/**
 * Verifies Discord's Ed25519 request signature. The body is read exactly once and returned as the
 * same string that was verified, so callers never re-read or re-serialise it.
 */
export async function verifyDiscordRequest(request: Request, publicKey: string): Promise<{ ok: true; body: string } | { ok: false }> {
  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");
  if (!signature || !timestamp || !/^[a-fA-F0-9]{128}$/.test(signature)) return { ok: false };

  const body = await request.text();
  try {
    return (await verifyKey(body, signature, timestamp, publicKey)) ? { ok: true, body } : { ok: false };
  } catch {
    return { ok: false };
  }
}
