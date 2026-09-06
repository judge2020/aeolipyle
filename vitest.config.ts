import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { TEST_PUBLIC_KEY_HEX } from "./test/fixtures/keys.ts";
export default defineConfig({
  // Bundle the Discord packages so their CommonJS exports work inside workerd.
  test: { deps: { optimizer: { ssr: { enabled: true, include: ["discord-api-types/v10", "discord-interactions"], rolldownOptions: { external: ["node:crypto"] } } } } },
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" }, miniflare: { bindings: { DISCORD_PUBLIC_KEY: TEST_PUBLIC_KEY_HEX } } })],
});
