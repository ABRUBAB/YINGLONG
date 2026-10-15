// Small BigInt elliptic-curve helpers used only by the probe to build test vectors:
// SM2 (GB/T 32918 recommended curve) signatures over a given digest e, and P-256 key/signature
// pairs for the RIP-7212 precompile check. Not constant time; test data only.
import { generateKeyPairSync, randomBytes, sign as nodeSign, createHash } from "node:crypto";

const mod = (a, m) => ((a % m) + m) % m;
const modPow = (b, e, m) => {
  let r = 1n;
  b = mod(b, m);
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return r;
};
const inv = (a, m) => modPow(mod(a, m), m - 2n, m);

function curveOps(c) {
  const add = (P, Q) => {
    if (P === null) return Q;
    if (Q === null) return P;
    if (P[0] === Q[0]) {
      if (mod(P[1] + Q[1], c.p) === 0n) return null;
      const l = mod((3n * P[0] * P[0] + c.a) * inv(2n * P[1], c.p), c.p);
      const x = mod(l * l - 2n * P[0], c.p);
      return [x, mod(l * (P[0] - x) - P[1], c.p)];
    }
    const l = mod((Q[1] - P[1]) * inv(Q[0] - P[0], c.p), c.p);
    const x = mod(l * l - P[0] - Q[0], c.p);
    return [x, mod(l * (P[0] - x) - P[1], c.p)];
  };
  const mul = (k, P) => {
    let R = null;
    let Q = P;
    while (k > 0n) {
      if (k & 1n) R = add(R, Q);
      Q = add(Q, Q);
      k >>= 1n;
    }
    return R;
  };
  const onCurve = (P) => mod(P[1] * P[1] - (P[0] * P[0] * P[0] + c.a * P[0] + c.b), c.p) === 0n;
  return { add, mul, onCurve };
}

export const SM2 = {
  p: 0xfffffffeffffffffffffffffffffffffffffffff00000000ffffffffffffffffn,
  a: 0xfffffffeffffffffffffffffffffffffffffffff00000000fffffffffffffffcn,
  b: 0x28e9fa9e9d9f5e344d5a9e4bcf6509a7f39789f515ab8f92ddbcbd414d940e93n,
  n: 0xfffffffeffffffffffffffffffffffff7203df6b21c6052b53bbf40939d54123n,
  G: [
    0x32c4ae2c1f1981195f9904466a39c9948fe30bbff2660be1715a4589334c74c7n,
    0xbc3736a2f4f6779c59bdcee36b692153d0a9877cc62a474002df32e52139f0a0n,
  ],
};

const hex32 = (v) => v.toString(16).padStart(64, "0");
const randScalar = (n) => {
  for (;;) {
    const k = BigInt(`0x${randBytesHex(32)}`);
    if (k > 0n && k < n - 1n) return k;
  }
};
const randBytesHex = (len) => randomBytes(len).toString("hex");

// Fresh random SM2 key pair. The private scalar stays in memory only.
export function sm2GenerateKey() {
  const ops = curveOps(SM2);
  if (!ops.onCurve(SM2.G)) throw new Error("SM2 generator not on curve");
  const d = randScalar(SM2.n);
  const P = ops.mul(d, SM2.G);
  return { d, P, publicKey: `0x${hex32(P[0])}${hex32(P[1])}` };
}

// Z_A preimage (GB/T 32918.2): ENTL || ID || a || b || xG || yG || xA || yA, default ID.
export function sm2ZPreimage(publicKeyHex, userId = "1234567812345678") {
  const id = Buffer.from(userId, "utf8").toString("hex");
  const entl = (userId.length * 8).toString(16).padStart(4, "0");
  return `0x${entl}${id}${hex32(SM2.a)}${hex32(SM2.b)}${hex32(SM2.G[0])}${hex32(SM2.G[1])}${publicKeyHex.slice(2)}`;
}

// Signs digest e (32 bytes hex) with key { d, P }. Returns { e, publicKey, r, s, selfCheck }.
export function sm2SignDigest(eHex, key = sm2GenerateKey()) {
  const c = SM2;
  const ops = curveOps(c);
  const { d, P } = key;
  const e = BigInt(eHex);
  let r;
  let s;
  for (;;) {
    const k = randScalar(c.n);
    const [x1] = ops.mul(k, c.G);
    r = mod(e + x1, c.n);
    if (r === 0n || r + k === c.n) continue;
    s = mod(inv(1n + d, c.n) * (k - r * d), c.n);
    if (s !== 0n) break;
  }
  // local verification: t = r + s, (x1', y1') = sG + tP, R = e + x1'
  const t = mod(r + s, c.n);
  const X = ops.add(ops.mul(s, c.G), ops.mul(t, P));
  const selfCheck = mod(e + X[0], c.n) === r;
  return { e: `0x${hex32(e)}`, publicKey: `0x${hex32(P[0])}${hex32(P[1])}`, r: `0x${hex32(r)}`, s: `0x${hex32(s)}`, selfCheck };
}

export const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

// P-256 key + signature over sha256(message), s normalised to the low half (RIP-7212 input).
export function p256Vector(message = "yinglong-fisco-probe") {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  const x = Buffer.from(jwk.x, "base64url").toString("hex").padStart(64, "0");
  const y = Buffer.from(jwk.y, "base64url").toString("hex").padStart(64, "0");
  const sig = nodeSign("sha256", Buffer.from(message), { key: privateKey, dsaEncoding: "ieee-p1363" });
  const r = sig.subarray(0, 32).toString("hex");
  let s = BigInt(`0x${sig.subarray(32).toString("hex")}`);
  if (s > P256_N / 2n) s = P256_N - s;
  const hash = createHash("sha256").update(message).digest("hex");
  return { hash: `0x${hash}`, r: `0x${r}`, s: `0x${hex32(s)}`, x: `0x${x}`, y: `0x${y}` };
}
