/**
 * Visitor sign-up end to end with a software authenticator: create a passkey (SPKI + COSE), register
 * through the live adapter, review both messages, sign both with the passkey (HybridDeleGator WebAuthn
 * encoding), seal, and remember the session. The mocked service verifies both signatures against the
 * public key it received, so a wrong encoding, digest or key fails the test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256, toHex } from "viem";
import { createLiveApi } from "./api/live";
import { readVisitorSession, clearVisitorSession } from "./api/session";
import { createFixtureVisitors, FISCO_DIRECTORY } from "./api/fixtures/visitor";
import { completeSignUp, createVisitorPasskey, reviewSignUp, signSignUp, SignUpRefusedError } from "./visitor";
import { fakeAuthenticator, memoryStorage } from "./testing/fake-authenticator";
import { decodeWebAuthnSignature } from "./passkey/verify";

const ORIGIN = "https://app.yinglong-agent.tech";
const H = (s: string) => keccak256(toHex(s));

function mockService(opts: { tamper?: (body: Record<string, unknown>) => void } = {}) {
  const sim = createFixtureVisitors();
  const seen: Array<{ method: string; path: string; headers: Record<string, string>; body: unknown }> = [];
  const contracts = Object.entries(FISCO_DIRECTORY)
    .filter(([k]) => k !== "ledger")
    .map(([name, address]) => ({ name, ledger: "fisco", chainId: 20200, address, codeHash: H(`code:${name}`) }));
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace("https://api.test", "");
    const method = init.method ?? "GET";
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    seen.push({ method, path, headers, body });
    try {
      if (method === "GET" && path === "/v1/evidence") return json({ generatedAt: "2026-10-16T01:00:00Z", items: [], contracts, commit: "abc" });
      if (method === "POST" && path === "/v1/visitors") {
        const s = sim.signUp(body);
        const wire = { ...s, ledger: "fisco" } as Record<string, unknown>;
        opts.tamper?.(wire);
        return json(wire);
      }
      const seal = /^\/v1\/visitors\/([^/]+)\/seal$/.exec(path);
      if (method === "POST" && seal) {
        const r = await sim.seal(seal[1]!, headers["x-visitor-token"] ?? "", body);
        const p = r.principal;
        return json({
          principal: {
            id: p.id,
            kind: "person",
            name: p.displayName,
            account: p.account,
            did: p.did,
            ledger: "fisco",
            ledgerBadge: p.ledgerBadge,
            jurisdiction: "hk",
            signer: p.signer,
            agent: { label: p.agentName, wallet: H("w").slice(0, 42), agentId: p.agentId, passportStatus: "active", identityCode: "YL-TEST-V0" },
            paused: false,
            passkeyIds: p.passkeys.map((k) => k.keyId),
          },
          mandateHash: r.mandateHash,
          publishTx: r.publishTx,
        });
      }
      return json({ ok: false, error: `no route ${method} ${path}` }, 404);
    } catch (e) {
      return json({ ok: false, error: (e as Error).message }, 400);
    }
  });
  return { fetchMock, seen };
}

let auth: ReturnType<typeof fakeAuthenticator>;

beforeEach(() => {
  auth = fakeAuthenticator({ origin: ORIGIN });
  vi.stubGlobal("navigator", { credentials: auth.credentials });
  vi.stubGlobal("window", {
    location: { hostname: "app.yinglong-agent.tech" },
    PublicKeyCredential: function PublicKeyCredential() {},
    localStorage: memoryStorage(),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
});
afterEach(() => {
  clearVisitorSession();
  vi.unstubAllGlobals();
});

describe("visitor sign-up with a real (software) passkey", () => {
  it("creates, reviews, signs twice, seals and remembers the visitor", async () => {
    const svc = mockService();
    vi.stubGlobal("fetch", svc.fetchMock);
    const api = createLiveApi("https://api.test");

    const key = await createVisitorPasskey();
    const cred = auth.creds[0]!;
    expect(key.credentialId).toBe(cred.id);
    expect(key.publicKey.x).toBe(`0x${Buffer.from(cred.point.slice(1, 33)).toString("hex")}`);

    const s = await api.visitorSignUp({ credentialId: key.credentialId, publicKey: key.publicKey });
    expect(svc.seen.find((r) => r.path === "/v1/visitors")?.body).toEqual({ credentialId: key.credentialId, publicKey: key.publicKey });
    const review = reviewSignUp(s, await api.contractDirectory(s.ledger));
    expect(review.problems).toEqual([]);
    expect(review.steps.map((st) => [st.step, st.guard.ok])).toEqual([
      ["publish", true],
      ["delegation", true],
    ]);

    const steps: string[] = [];
    const sigs = await signSignUp(review, key.credentialId, (st) => steps.push(st));
    expect(steps).toEqual(["publish", "delegation"]);
    expect(auth.calls.get).toBe(2);
    // Both are HybridDeleGator WebAuthn encodings over the two digests, with user verification required.
    expect(decodeWebAuthnSignature(sigs.userOpSignature).requireUserVerification).toBe(true);

    const sealed = await completeSignUp(api, s, key, sigs);
    expect(sealed.principal.signer).toBe("passkey (WebAuthn)");
    expect(sealed.principal.passkeys.map((k) => k.keyId)).toEqual([key.credentialId]);
    const sealCall = svc.seen.find((r) => r.path.endsWith("/seal"))!;
    expect(sealCall.headers["x-visitor-token"]).toBe(s.token);
    expect(readVisitorSession()).toMatchObject({ visitorId: s.visitorId, token: s.token, credentialId: key.credentialId, publicKey: key.publicKey });

    // From now on the console acts for the visitor, and its POSTs carry the session token.
    await api.ask({ text: "Buy a coffee at Arena Cafe for 4" }).catch(() => undefined);
    const ask = svc.seen.find((r) => r.path.endsWith("/ask"))!;
    expect(ask.path).toBe(`/v1/principals/${s.visitorId}/ask`);
    expect(ask.headers["x-visitor-token"]).toBe(s.token);
  });

  it("refuses to sign when the service hands over a delegation to someone else's agent", async () => {
    const svc = mockService({
      tamper: (wire) => {
        const req = (wire.requests as Array<{ step: string; typedData: { message: Record<string, unknown> } }>).find((r) => r.step === "delegation")!;
        req.typedData.message.delegate = `0x${"ab".repeat(20)}`;
      },
    });
    vi.stubGlobal("fetch", svc.fetchMock);
    const api = createLiveApi("https://api.test");
    const key = await createVisitorPasskey();
    const s = await api.visitorSignUp({ credentialId: key.credentialId, publicKey: key.publicKey });
    const review = reviewSignUp(s, await api.contractDirectory(s.ledger));
    expect(review.ok).toBe(false);
    expect(review.problems.join(" ")).toMatch(/digest|your own agent wallet/);
    await expect(signSignUp(review, key.credentialId)).rejects.toBeInstanceOf(SignUpRefusedError);
    expect(auth.calls.get).toBe(0);
  });

  it("a signature from another passkey does not seal", async () => {
    const svc = mockService();
    vi.stubGlobal("fetch", svc.fetchMock);
    const api = createLiveApi("https://api.test");
    const key = await createVisitorPasskey();
    const s = await api.visitorSignUp({ credentialId: key.credentialId, publicKey: key.publicKey });
    const review = reviewSignUp(s, await api.contractDirectory(s.ledger));
    const other = await createVisitorPasskey(); // a second credential on the same authenticator
    const sigs = await signSignUp(review, other.credentialId);
    await expect(completeSignUp(api, s, key, sigs)).rejects.toThrow(/does not verify/);
    expect(readVisitorSession()).toBeNull();
  });
});
