/**
 * Data access. The live adapter (NEXT_PUBLIC_AGENT_API) is the default; the fixture adapter is
 * used only when NEXT_PUBLIC_DATA_MODE=fixtures and is always labelled "Sample data" in the UI.
 */
import type { AgentApi, DataMode } from "./client";
import { createLiveApi } from "./live";
import { createFixtureApi } from "./fixtures/adapter";

export const DATA_MODE: DataMode = process.env.NEXT_PUBLIC_DATA_MODE === "fixtures" ? "fixtures" : "live";
export const AGENT_API_URL = process.env.NEXT_PUBLIC_AGENT_API || "https://api.yinglong-agent.tech";

let instance: AgentApi | null = null;

export function getApi(): AgentApi {
  if (!instance) instance = DATA_MODE === "fixtures" ? createFixtureApi() : createLiveApi(AGENT_API_URL);
  return instance;
}

export const isSample = DATA_MODE === "fixtures";

export type { AgentApi, DataMode } from "./client";
export { ApiRequestError } from "./client";
