import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { TEST_PUBLIC_KEY_HEX } from "./test/fixtures/keys.ts";

export default defineConfig({
  test: {
    deps: {
      optimizer: {
        ssr: {
          // Pre-bundle the Discord packages: they ship CommonJS, which workerd cannot load directly.
          enabled: true,
          include: ["discord-api-types/v10", "discord-interactions"],
          // discord-interactions references node:crypto only in an unreachable fallback branch;
          // production has WebCrypto and no nodejs_compat flag, so keep it external here too.
          rolldownOptions: { external: ["node:crypto"] },
        },
      },
    },
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // Tests sign requests with the committed test keypair, never the production key.
      miniflare: { bindings: { DISCORD_PUBLIC_KEY: TEST_PUBLIC_KEY_HEX } },
    }),
  ],
});
