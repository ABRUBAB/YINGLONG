import { defineConfig } from "vitest/config";

// Tests never call the real Cerebras endpoint through the developer key file next to the repository;
// the provider tests switch it on explicitly with their own fake key.
export default defineConfig({ test: { env: { CEREBRAS_DISABLED: "1" } } });
