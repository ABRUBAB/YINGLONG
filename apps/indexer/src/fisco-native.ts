// FISCO BCOS native JSON-RPC (TLS with the chain's SDK client certificate), used for one read only: the native
// transaction receipt, whose `output` holds the exact revert data of a failed transaction as executed. The Web3 RPC
// returns no revert data, and replaying with eth_call runs against the latest state (FISCO ignores block tags), so
// a replay can give a different reason once state has changed. The native receipt does not.
import { readFileSync, existsSync } from "node:fs";
import { request } from "node:https";
import { resolve } from "node:path";

export interface NativeRevert {
  /** FISCO transaction status code (0 = success; 16 = RevertInstruction). */
  status: number;
  /** Return data of the transaction as executed: the ABI-encoded custom error for a revert. */
  output: string;
  message: string;
  blockNumber?: number;
}

export interface NativeConfig {
  url: string; // e.g. https://127.0.0.1:20204 (the observer node, which plays the regulator node)
  sdkDir: string; // ca.crt, sdk.crt, sdk.key
  group?: string;
}

export function nativeConfigFromEnv(env: NodeJS.ProcessEnv): NativeConfig | undefined {
  const url = env.FISCO_NATIVE_RPC_URL;
  const sdkDir = env.FISCO_SDK_DIR;
  if (!url || !sdkDir || !existsSync(resolve(sdkDir, "sdk.key"))) return undefined;
  return { url, sdkDir, group: env.FISCO_GROUP ?? "group0" };
}

export function makeNativeRevertReader(cfg: NativeConfig): (txHash: string) => Promise<NativeRevert | undefined> {
  const ca = readFileSync(resolve(cfg.sdkDir, "ca.crt"));
  const cert = readFileSync(resolve(cfg.sdkDir, "sdk.crt"));
  const key = readFileSync(resolve(cfg.sdkDir, "sdk.key"));
  const u = new URL(cfg.url);
  return (txHash) =>
    new Promise((done) => {
      const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransactionReceipt", params: [cfg.group ?? "group0", "", txHash, false] });
      const req = request(
        {
          host: u.hostname,
          port: Number(u.port || 443),
          path: "/",
          method: "POST",
          ca,
          cert,
          key,
          // The node certificate is issued by the chain's own CA for a node id, not for a host name.
          checkServerIdentity: () => undefined,
          headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
          timeout: 10_000,
        },
        (res) => {
          let text = "";
          res.on("data", (c) => (text += c));
          res.on("end", () => {
            try {
              const r = (JSON.parse(text) as { result?: { status?: number; output?: string; message?: string; blockNumber?: number } }).result;
              done(r ? { status: Number(r.status ?? 0), output: r.output ?? "0x", message: r.message ?? "", blockNumber: r.blockNumber } : undefined);
            } catch {
              done(undefined);
            }
          });
        },
      );
      req.on("error", () => done(undefined));
      req.on("timeout", () => req.destroy());
      req.end(body);
    });
}
