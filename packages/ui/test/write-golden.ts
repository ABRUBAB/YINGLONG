// Regenerates packages/ui/test/golden/*.json. Run: pnpm --filter @yinglong/ui golden
// Only regenerate when the spec in docs/HASH_RING.md changes; the Python twin must match these files.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { hashBytes, hashRingGeometry } from "../src/hash-ring/geometry.ts";
import { GOLDEN_VECTORS, toHex } from "./vectors.ts";

const dir = join(dirname(fileURLToPath(import.meta.url)), "golden");
for (const v of GOLDEN_VECTORS) {
  const doc = {
    spec: "docs/HASH_RING.md v1",
    H: v.H,
    K: toHex(keccak_256(hashBytes(v.H))),
    R: 1,
    revoked: v.revoked,
    geometry: hashRingGeometry(v.H, { revoked: v.revoked }),
  };
  writeFileSync(join(dir, `${v.name}.json`), `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`golden/${v.name}.json`);
}
