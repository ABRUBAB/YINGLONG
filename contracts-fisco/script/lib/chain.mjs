// Minimal, dependency-free helpers for talking to an EVM JSON-RPC endpoint (FISCO BCOS Web3 RPC
// or anvil) from Node 22: keccak-256, RLP, raw transaction building, artifact loading and linking.
// ECDSA signatures are produced by Foundry's `cast wallet sign --no-hash` so no secp256k1 code
// lives here. Private keys are only ever passed to that child process; they are never printed,
// logged or written to disk.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const REPO_DIR = resolve(PROJECT_DIR, "..");

// ---------------------------------------------------------------------------------------------
// hex and bytes
// ---------------------------------------------------------------------------------------------
export const strip0x = (h) => (h.startsWith("0x") || h.startsWith("0X") ? h.slice(2) : h);
export const hexToBytes = (h) => {
  const s = strip0x(h);
  if (s.length % 2) throw new Error(`odd hex length: ${s.length}`);
  return Uint8Array.from(Buffer.from(s, "hex"));
};
export const bytesToHex = (b) => `0x${Buffer.from(b).toString("hex")}`;
export const concatHex = (...parts) => `0x${parts.map(strip0x).join("")}`;
export const toQuantity = (n) => `0x${BigInt(n).toString(16)}`;
export const padHex = (h, bytes = 32) => `0x${strip0x(h).padStart(bytes * 2, "0")}`;
export const utf8Hex = (s) => bytesToHex(Buffer.from(s, "utf8"));

// ---------------------------------------------------------------------------------------------
// keccak-256 (original Keccak padding 0x01, as used by Ethereum)
// ---------------------------------------------------------------------------------------------
const MASK64 = (1n << 64n) - 1n;
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
// ROT[x][y]
const ROT = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];
const rotl = (v, n) => (n === 0 ? v : ((v << BigInt(n)) | (v >> BigInt(64 - n))) & MASK64);

function keccakF(A) {
  const C = new Array(5);
  const B = new Array(25);
  for (let round = 0; round < 24; round++) {
    for (let x = 0; x < 5; x++) C[x] = A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20];
    for (let x = 0; x < 5; x++) {
      const d = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y++) A[x + 5 * y] ^= d;
    }
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(A[x + 5 * y], ROT[x][y]);
      }
    }
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        A[x + 5 * y] = B[x + 5 * y] ^ (~B[((x + 1) % 5) + 5 * y] & MASK64 & B[((x + 2) % 5) + 5 * y]);
      }
    }
    A[0] ^= RC[round];
  }
}

export function keccak256(input) {
  const data = typeof input === "string" ? hexToBytes(input) : input;
  const rate = 136;
  const padLen = rate - (data.length % rate);
  const msg = new Uint8Array(data.length + padLen);
  msg.set(data);
  msg[data.length] ^= 0x01;
  msg[msg.length - 1] ^= 0x80;
  const A = new Array(25).fill(0n);
  for (let off = 0; off < msg.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(msg[off + i * 8 + b]);
      A[i] ^= lane;
    }
    keccakF(A);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    let lane = A[i];
    for (let b = 0; b < 8; b++) {
      out[i * 8 + b] = Number(lane & 0xffn);
      lane >>= 8n;
    }
  }
  return bytesToHex(out);
}

// ---------------------------------------------------------------------------------------------
// RLP
// ---------------------------------------------------------------------------------------------
const intToBytes = (n) => {
  let v = BigInt(n);
  if (v === 0n) return new Uint8Array(0);
  const out = [];
  while (v > 0n) {
    out.unshift(Number(v & 0xffn));
    v >>= 8n;
  }
  return Uint8Array.from(out);
};
const lengthPrefix = (len, offset) => {
  if (len <= 55) return Uint8Array.from([offset + len]);
  const lb = intToBytes(len);
  return Uint8Array.from([offset + 55 + lb.length, ...lb]);
};
const concatBytes = (arr) => {
  const total = arr.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of arr) {
    out.set(a, o);
    o += a.length;
  }
  return out;
};
// Items: Uint8Array (bytes), bigint/number (integer), Array (list).
export function rlp(item) {
  if (Array.isArray(item)) {
    const payload = concatBytes(item.map(rlp));
    return concatBytes([lengthPrefix(payload.length, 0xc0), payload]);
  }
  const bytes = item instanceof Uint8Array ? item : intToBytes(item);
  if (bytes.length === 1 && bytes[0] < 0x80) return bytes;
  return concatBytes([lengthPrefix(bytes.length, 0x80), bytes]);
}

// ---------------------------------------------------------------------------------------------
// Foundry binaries
// ---------------------------------------------------------------------------------------------
function foundryBin(name) {
  const dir = process.env.FOUNDRY_BIN_DIR || (process.platform === "win32" ? "D:/tools/foundry" : "");
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  if (dir && existsSync(join(dir, exe))) return join(dir, exe);
  return name;
}

// Runs cast. `secretArgs` marks the call as carrying a key: on failure only stderr is reported.
export function cast(args, { secretArgs = false, input } = {}) {
  const r = spawnSync(foundryBin("cast"), args, { encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`cast could not start: ${r.error.message}`);
  if (r.status !== 0) {
    const what = secretArgs ? args[0] + " " + (args[1] || "") : args.slice(0, 3).join(" ");
    throw new Error(`cast ${what} failed: ${(r.stderr || "").trim()}`);
  }
  return r.stdout.trim();
}

export const calldata = (sig, ...args) => cast(["calldata", sig, ...args.map(String)]);
export const abiEncode = (sig, ...args) => cast(["abi-encode", sig, ...args.map(String)]);
// Returns the decoded values as cast prints them (one per line).
export const abiDecode = (sig, data) => cast(["decode-abi", sig, data]).split(/\r?\n/);
export const selector = (sig) => keccak256(utf8Hex(sig)).slice(0, 10);

export function addressOf(privateKey) {
  return cast(["wallet", "address", "--private-key", privateKey], { secretArgs: true });
}

// Signs a 32-byte digest (no prefix, no hashing). Returns { r, s, v } with v in {27, 28}.
export function signDigest(privateKey, digest) {
  const sig = strip0x(cast(["wallet", "sign", "--no-hash", digest, "--private-key", privateKey], { secretArgs: true }));
  if (sig.length !== 130) throw new Error("unexpected signature length");
  return { r: `0x${sig.slice(0, 64)}`, s: `0x${sig.slice(64, 128)}`, v: parseInt(sig.slice(128, 130), 16), hex: `0x${sig}` };
}

// ---------------------------------------------------------------------------------------------
// keys
// ---------------------------------------------------------------------------------------------
export function loadRoleKeys() {
  const file = process.env.YINGLONG_KEYS_FILE || resolve(REPO_DIR, "..", ".secrets", "testnet-keys.json");
  const doc = JSON.parse(readFileSync(file, "utf8"));
  const roles = {};
  for (const [name, v] of Object.entries(doc.roles)) {
    const pk = v.privateKey.startsWith("0x") ? v.privateKey : `0x${v.privateKey}`;
    roles[name] = { address: v.address, privateKey: pk };
  }
  return roles;
}

// ---------------------------------------------------------------------------------------------
// JSON-RPC
// ---------------------------------------------------------------------------------------------
export class RpcError extends Error {
  constructor(method, error) {
    super(`${method}: ${error?.message ?? JSON.stringify(error)}`);
    this.method = method;
    this.code = error?.code;
    this.data = error?.data;
    this.rpcMessage = error?.message;
  }
}

export class Rpc {
  constructor(url) {
    this.url = url;
    this.id = 0;
  }
  async raw(method, params = []) {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }),
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { error: { code: res.status, message: `non-JSON response: ${text.slice(0, 200)}` } };
    }
  }
  async call(method, params = []) {
    const r = await this.raw(method, params);
    if (r.error) throw new RpcError(method, r.error);
    return r.result;
  }
  async receipt(hash, timeoutMs = 60000) {
    const start = Date.now();
    for (;;) {
      const r = await this.call("eth_getTransactionReceipt", [hash]).catch(() => null);
      if (r) return r;
      if (Date.now() - start > timeoutMs) throw new Error(`no receipt for ${hash} after ${timeoutMs} ms`);
      await new Promise((ok) => setTimeout(ok, 200));
    }
  }
}

// ---------------------------------------------------------------------------------------------
// transactions
// ---------------------------------------------------------------------------------------------
export class Signer {
  constructor(rpc, privateKey, label = "signer") {
    this.rpc = rpc;
    this.pk = privateKey;
    this.label = label;
    this.address = addressOf(privateKey);
    this.nonce = null;
  }

  async init() {
    this.chainId = BigInt(await this.rpc.call("eth_chainId"));
    this.nonce = BigInt(await this.rpc.call("eth_getTransactionCount", [this.address, "latest"]));
    return this;
  }

  // Builds, signs and sends a transaction. Options:
  //   to (omit for contract creation), data, value, gas (skip estimation), type (0 or 2),
  //   gasPrice / maxFeePerGas / maxPriorityFeePerGas (default from the node).
  // Returns { hash, receipt, sentAt, minedAfterMs, gas, type, nonce, estimateError }.
  async send({ to = null, data = "0x", value = 0n, gas, type = 0, gasPrice, maxFeePerGas, maxPriorityFeePerGas, wait = true }) {
    if (this.nonce === null) await this.init();
    const nonce = this.nonce;
    let estimateError = null;
    if (gas === undefined) {
      const est = { from: this.address, data, value: toQuantity(value) };
      if (to) est.to = to;
      try {
        gas = (BigInt(await this.rpc.call("eth_estimateGas", [est])) * 13n) / 10n + 50000n;
      } catch (e) {
        estimateError = e;
        throw e;
      }
    }
    gas = BigInt(gas);
    const toBytes = to ? hexToBytes(to) : new Uint8Array(0);
    const dataBytes = hexToBytes(data);
    let raw;
    if (type === 2) {
      const tip = BigInt(maxPriorityFeePerGas ?? 0n);
      const base = await this.rpc.call("eth_getBlockByNumber", ["latest", false]);
      const fee = BigInt(maxFeePerGas ?? (base?.baseFeePerGas ? BigInt(base.baseFeePerGas) * 2n + tip : tip));
      const fields = [this.chainId, nonce, tip, fee, gas, toBytes, BigInt(value), dataBytes, []];
      const digest = keccak256(concatBytes([Uint8Array.from([2]), rlp(fields)]));
      const sig = signDigest(this.pk, digest);
      const signed = [...fields, BigInt(sig.v - 27), hexToBytes(sig.r), hexToBytes(sig.s)];
      raw = bytesToHex(concatBytes([Uint8Array.from([2]), rlp(signed)]));
    } else {
      const price = BigInt(gasPrice ?? (await this.rpc.call("eth_gasPrice")));
      const fields = [nonce, price, gas, toBytes, BigInt(value), dataBytes];
      const digest = keccak256(rlp([...fields, this.chainId, 0n, 0n]));
      const sig = signDigest(this.pk, digest);
      const v = BigInt(sig.v - 27) + this.chainId * 2n + 35n;
      raw = bytesToHex(rlp([...fields, v, hexToBytes(sig.r), hexToBytes(sig.s)]));
    }
    const sentAt = Date.now();
    const hash = await this.rpc.call("eth_sendRawTransaction", [raw]);
    this.nonce = nonce + 1n;
    if (!wait) return { hash, nonce, gas, type, sentAt };
    const receipt = await this.rpc.receipt(hash);
    return { hash, receipt, sentAt, minedAfterMs: Date.now() - sentAt, gas, type, nonce, estimateError };
  }
}

// CREATE address: keccak256(rlp([sender, nonce]))[12:]
export function createAddress(sender, nonce) {
  const h = keccak256(rlp([hexToBytes(sender), BigInt(nonce)]));
  return checksum(`0x${h.slice(26)}`);
}

// CREATE2 address: keccak256(0xff ++ deployer ++ salt ++ keccak256(initCode))[12:]
export function create2Address(deployer, salt, initCodeHash) {
  const h = keccak256(concatHex("0xff", deployer, padHex(salt), initCodeHash));
  return checksum(`0x${h.slice(26)}`);
}

export function checksum(address) {
  const a = strip0x(address).toLowerCase();
  const h = strip0x(keccak256(utf8Hex(a)));
  let out = "0x";
  for (let i = 0; i < 40; i++) out += parseInt(h[i], 16) >= 8 ? a[i].toUpperCase() : a[i];
  return out;
}

// ---------------------------------------------------------------------------------------------
// artifacts
// ---------------------------------------------------------------------------------------------
export function loadArtifact(file, name) {
  const path = join(PROJECT_DIR, "out", file, `${name}.json`);
  const a = JSON.parse(readFileSync(path, "utf8"));
  return {
    name,
    abi: a.abi,
    bytecode: a.bytecode.object,
    deployedBytecode: a.deployedBytecode.object,
    linkReferences: a.bytecode.linkReferences || {},
    deployedLinkReferences: a.deployedBytecode.linkReferences || {},
    immutableReferences: a.deployedBytecode.immutableReferences || {},
  };
}

// Replaces library placeholders. `libs` maps library name -> address.
export function link(bytecode, linkReferences, libs) {
  let code = strip0x(bytecode);
  for (const fileRefs of Object.values(linkReferences)) {
    for (const [lib, refs] of Object.entries(fileRefs)) {
      const addr = libs[lib];
      if (!addr) throw new Error(`missing library address for ${lib}`);
      for (const { start, length } of refs) {
        code = code.slice(0, start * 2) + strip0x(addr).toLowerCase().padStart(length * 2, "0") + code.slice((start + length) * 2);
      }
    }
  }
  if (code.includes("__$")) throw new Error("unlinked library placeholder left in bytecode");
  return `0x${code}`;
}

// Zeroes every immutable slot in a runtime bytecode (positions from the compiler artifact).
export function maskImmutables(runtimeHex, immutableReferences) {
  let code = strip0x(runtimeHex);
  for (const refs of Object.values(immutableReferences)) {
    for (const { start, length } of refs) {
      code = code.slice(0, start * 2) + "00".repeat(length) + code.slice((start + length) * 2);
    }
  }
  return `0x${code}`;
}

// Decodes an Error(string) / Panic(uint256) / custom error revert payload.
export function decodeRevert(data) {
  if (!data || data === "0x") return { kind: "empty" };
  const sel = data.slice(0, 10).toLowerCase();
  if (sel === "0x08c379a0") {
    const [reason] = abiDecode("f()(string)", `0x${data.slice(10)}`);
    return { kind: "Error(string)", reason: reason.replace(/^"|"$/g, "") };
  }
  if (sel === "0x4e487b71") {
    const [code] = abiDecode("f()(uint256)", `0x${data.slice(10)}`);
    return { kind: "Panic(uint256)", code };
  }
  return { kind: "custom", selector: sel, data };
}

export const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
