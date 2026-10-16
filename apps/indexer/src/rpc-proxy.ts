// Read-only JSON-RPC proxy for the FISCO BCOS ledger (plan section 16.2 / the only public path to FISCO).
// It forwards an allowlist of read methods only and rejects everything else (writes, admin, debug, trace),
// with per-IP rate limits and a bounded block range on eth_getLogs. The upstream FISCO RPC is never exposed
// directly; auth is off on that chain, so write methods MUST never reach it.

/** Read methods the proxy will forward. Anything not here is rejected. */
export const ALLOWED_METHODS = new Set<string>([
  "eth_chainId",
  "net_version",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_call",
  "eth_getLogs",
  "eth_getCode",
  "eth_getBalance",
  "eth_getStorageAt",
]);

export interface RpcRequest {
  jsonrpc?: string;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

export interface ProxyConfig {
  upstreamUrl?: string;
  ratePerMin: number;
  maxBlockRange: number;
  fetchImpl?: typeof fetch;
  /** Reads the exact revert data of a transaction from the FISCO native receipt (see fisco-native.ts). */
  nativeRevert?: (txHash: string) => Promise<{ status: number; output: string; message: string; blockNumber?: number } | undefined>;
}

/**
 * Extra read method answered by this proxy itself: `yinglong_getRevertData(txHash)` returns
 * {status, output, message} from the FISCO native receipt (status 0 = success; output = the revert data as executed).
 */
export const LOCAL_METHODS = new Set<string>(["yinglong_getRevertData"]);

export const RPC_ERRORS = {
  parse: { code: -32700, message: "parse error" },
  invalid: { code: -32600, message: "invalid request" },
  methodNotAllowed: { code: -32601, message: "method not allowed by the read-only FISCO proxy" },
  rangeTooLarge: (max: number) => ({ code: -32005, message: `eth_getLogs block range exceeds the proxy limit of ${max} blocks` }),
  blockHashFilter: { code: -32602, message: "eth_getLogs blockHash filters are not supported by the FISCO proxy" },
  rateLimited: { code: -32029, message: "rate limit exceeded" },
  upstream: { code: -32010, message: "upstream FISCO RPC unavailable" },
  notConfigured: { code: -32010, message: "FISCO RPC proxy upstream is not configured" },
} as const;

class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private readonly perMin: number) {}
  allow(ip: string): boolean {
    const now = Date.now();
    const windowStart = now - 60_000;
    const arr = (this.hits.get(ip) ?? []).filter((t) => t > windowStart);
    if (arr.length >= this.perMin) {
      this.hits.set(ip, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(ip, arr);
    return true;
  }
}

const jsonError = (id: unknown, error: { code: number; message: string }) => ({ jsonrpc: "2.0", id: id ?? null, error });

function hexToBig(v: unknown): bigint | undefined {
  if (typeof v !== "string") return undefined;
  if (v === "latest" || v === "pending" || v === "earliest" || v === "safe" || v === "finalized") return undefined;
  try {
    return BigInt(v);
  } catch {
    return undefined;
  }
}

export class FiscoRpcProxy {
  private readonly limiter: RateLimiter;
  private readonly doFetch: typeof fetch;

  constructor(private readonly config: ProxyConfig) {
    this.limiter = new RateLimiter(config.ratePerMin);
    this.doFetch = config.fetchImpl ?? fetch;
  }

  /** Validate a single JSON-RPC request against the allowlist and eth_getLogs bounds. */
  validate(req: RpcRequest): { ok: true } | { ok: false; error: { code: number; message: string } } {
    if (!req || typeof req.method !== "string") return { ok: false, error: RPC_ERRORS.invalid };
    if (LOCAL_METHODS.has(req.method)) {
      const h = Array.isArray(req.params) ? req.params[0] : undefined;
      if (!this.config.nativeRevert || typeof h !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(h)) return { ok: false, error: RPC_ERRORS.methodNotAllowed };
      return { ok: true };
    }
    if (!ALLOWED_METHODS.has(req.method)) return { ok: false, error: RPC_ERRORS.methodNotAllowed };
    if (req.method === "eth_getLogs") {
      const filter = Array.isArray(req.params) ? (req.params[0] as Record<string, unknown> | undefined) : undefined;
      if (filter && typeof filter === "object") {
        if ("blockHash" in filter && filter.blockHash != null) return { ok: false, error: RPC_ERRORS.blockHashFilter };
        const from = hexToBig(filter.fromBlock);
        const to = hexToBig(filter.toBlock);
        if (from !== undefined && to !== undefined && to - from + 1n > BigInt(this.config.maxBlockRange)) {
          return { ok: false, error: RPC_ERRORS.rangeTooLarge(this.config.maxBlockRange) };
        }
      }
    }
    return { ok: true };
  }

  /** Handle one or a batch of JSON-RPC requests from `ip`. Returns the JSON body to send back. */
  async handle(body: unknown, ip: string): Promise<{ status: number; body: unknown }> {
    if (!this.config.upstreamUrl) return { status: 503, body: jsonError((body as RpcRequest)?.id, RPC_ERRORS.notConfigured) };
    if (!this.limiter.allow(ip)) return { status: 429, body: jsonError((body as RpcRequest)?.id, RPC_ERRORS.rateLimited) };

    const isBatch = Array.isArray(body);
    const reqs = (isBatch ? body : [body]) as RpcRequest[];
    if (reqs.length === 0 || reqs.length > 20) return { status: 400, body: jsonError(null, RPC_ERRORS.invalid) };

    // Reject the whole call if any sub-request is not allowed (no partial forwarding of mixed batches).
    for (const r of reqs) {
      const v = this.validate(r);
      if (!v.ok) return { status: 200, body: isBatch ? reqs.map((x) => jsonError(x.id, v.error)) : jsonError(reqs[0]!.id, v.error) };
    }

    // Local methods are answered here (each one alone: no mixing with forwarded requests).
    if (reqs.some((r) => LOCAL_METHODS.has(r.method as string))) {
      const out = await Promise.all(
        reqs.map(async (r) => {
          if (!LOCAL_METHODS.has(r.method as string)) return jsonError(r.id, RPC_ERRORS.invalid);
          const v = await this.config.nativeRevert!(String((r.params as unknown[])[0]));
          return v ? { jsonrpc: "2.0", id: r.id ?? null, result: v } : jsonError(r.id, RPC_ERRORS.upstream);
        }),
      );
      return { status: 200, body: isBatch ? out : out[0] };
    }

    // Forward only the sanitised, allowed fields upstream.
    const forwarded = reqs.map((r) => ({ jsonrpc: "2.0", id: r.id ?? null, method: r.method, params: Array.isArray(r.params) ? r.params : [] }));
    try {
      const res = await this.doFetch(this.config.upstreamUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(isBatch ? forwarded : forwarded[0]),
        signal: AbortSignal.timeout(20_000),
      });
      const text = await res.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { status: 502, body: jsonError(null, RPC_ERRORS.upstream) };
      }
      return { status: 200, body: parsed };
    } catch {
      return { status: 502, body: jsonError(null, RPC_ERRORS.upstream) };
    }
  }
}
