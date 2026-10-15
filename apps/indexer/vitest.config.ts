import { defineConfig } from "vitest/config";

// Tests run against the local Anvil ledger (http://127.0.0.1:8645 by default) and send real transactions,
// so files run one at a time.
export default defineConfig({
  test: {
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
