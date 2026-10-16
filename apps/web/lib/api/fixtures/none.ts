import type { AgentApi } from "../client";

/** Live builds: the sample-data adapter is not bundled (see next.config.ts, turbopack.resolveAlias). */
export function createFixtureApi(): AgentApi {
  throw new Error("This build has no sample data: NEXT_PUBLIC_DATA_MODE is not fixtures.");
}
