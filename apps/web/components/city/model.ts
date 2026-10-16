import type { CityAgent, CityBatch, CityLedger, CityPassport, CityPrincipal, CityReceipt, CitySnapshot, Ledger } from "@/lib/api/view";

/**
 * Agent City graph, derived only from the service snapshot (principals, passport registry, payee books,
 * receipts, ledger health, anchoring batches). Nothing here names a cast member: who appears, on which
 * rail, with which passport and which payments, all comes from the data.
 *
 * Rails: "fisco" is the Shenzhen plane (mainland profile, coin-free rail), drawn north of the seam;
 * "hk" is the Hong Kong plane (HK test rail), drawn south of it, as on a map of the Greater Bay.
 */
export type Rail = "fisco" | "hk";
export type EdgeState = "settled" | "awaiting" | "refused";
export const EDGE_STATES: EdgeState[] = ["settled", "awaiting", "refused"];

export type NodeGlyph = CityPassport | "person" | "company" | "visitors" | "payee" | "unverified" | "regulator" | "anchor" | "anchor-empty";

export interface StateCounts {
  settled: number;
  awaiting: number;
  refused: number;
}

interface NodeBase {
  id: string;
  rail: Rail;
  title: string;
  /** Second line (plain text). */
  subtitle: string;
  glyph: NodeGlyph;
  /** Receipts that touch this node, newest first. */
  receipts: CityReceipt[];
  counts: StateCounts;
}

export interface PrincipalNode extends NodeBase {
  kind: "principal";
  group: string;
  principals: CityPrincipal[];
}
export interface AgentNode extends NodeBase {
  kind: "agent";
  group: string;
  principals: CityPrincipal[];
  /** Other principals (any rail) whose agent carries the same passport. */
  sharedWith: string[];
}
export interface CounterpartyNode extends NodeBase {
  kind: "counterparty";
  address: string | null;
  category: string | null;
  /** Principals whose payee book lists this address. */
  listedBy: string[];
  /** The passport-registry entry at this address, when there is one. */
  registered: CityAgent | null;
  ledgers: Ledger[];
}
export interface RegulatorNode extends NodeBase {
  kind: "regulator";
  ledger: CityLedger | null;
}
export interface AnchorNode extends NodeBase {
  kind: "anchor";
  ledger: Ledger;
  badge: string;
  batches: CityBatch[];
}

export type CityNode = PrincipalNode | AgentNode | CounterpartyNode | RegulatorNode | AnchorNode;

export interface CityEdge {
  id: string;
  kind: "mandate" | "payment" | "identity" | "anchor" | "observe";
  from: string;
  to: string;
  rail: Rail | "seam";
  state: EdgeState;
  receipts: CityReceipt[];
  /** Mandate edges: the sealed mandate's status (chrome when live, dashed when revoked). */
  mandate?: "live" | "revoked" | "superseded" | "none";
}

export interface PrincipalGroup {
  id: string;
  rail: Rail;
  principal: string;
  agent: string;
  kind: "person" | "company" | "visitors";
  /** Sort key inside the plane (companies sit next to the seam). */
  order: number;
}

export interface RailInfo {
  rail: Rail;
  ledgers: { ledger: Ledger; badge: string }[];
}

export interface CityModel {
  nodes: Map<string, CityNode>;
  edges: CityEdge[];
  groups: PrincipalGroup[];
  rails: Record<Rail, RailInfo>;
  /** Receipts shown on the map (live ledgers only), newest first. */
  receipts: CityReceipt[];
  batches: CityBatch[];
  batchesReadable: boolean;
  /** Which edge carries each receipt (for packets and the feed). */
  edgeOfReceipt: Map<string, string>;
  /** Which principal group each receipt belongs to. */
  visitorCount: number;
}

/** Visitors beyond this many are drawn as one group (their rows stay in the inspector). */
export const VISITORS_INLINE = 2;

/** The anchor ledger on each side of the seam (the rail's home ledger, from the rail profile). */
export const RAIL_LEDGER: Record<Rail, Ledger> = { fisco: "fisco", hk: "base-sepolia" };

export const railOfJurisdiction = (j: CityPrincipal["jurisdiction"]): Rail => (j === "mainland" ? "fisco" : "hk");

export function stateOf(r: CityReceipt): EdgeState | null {
  switch (r.outcome) {
    case "confirmed":
      return "settled";
    case "awaiting_approval":
    case "asked":
    case "pending":
      return "awaiting";
    case "reverted":
    case "rejected_policy":
    case "expired":
      return "refused";
    default:
      return null;
  }
}

const zero = (): StateCounts => ({ settled: 0, awaiting: 0, refused: 0 });

export function countStates(rs: CityReceipt[]): StateCounts {
  const c = zero();
  for (const r of rs) {
    const s = stateOf(r);
    if (s) c[s] += 1;
  }
  return c;
}

/** "attacker (prompt injection)" -> title "attacker", note "prompt injection". */
export function splitLabel(label: string): { title: string; note: string | null } {
  const m = /^(.*?)\s*\((.+)\)\s*$/.exec(label);
  if (!m || !m[1]) return { title: label, note: null };
  return { title: m[1], note: m[2] ?? null };
}

/**
 * A receipt is a payment when it names a payee and either moves value or was stopped or held on its way
 * there (a refused quote from a rogue agent carries no amount). A confirmed zero-value call, such as
 * resuming a paused agent, is a control action on the mandate.
 */
const isPayment = (r: CityReceipt) => {
  if (!r.payee) return false;
  let value = 0n;
  try {
    value = r.amount ? BigInt(r.amount.value) : 0n;
  } catch {
    value = 0n;
  }
  return value > 0n || stateOf(r) !== "settled";
};

const lc = (a: string | null | undefined) => (a ? a.toLowerCase() : null);

export function buildCity(snap: CitySnapshot): CityModel {
  const nodes = new Map<string, CityNode>();
  const groups: PrincipalGroup[] = [];
  const groupOfPrincipal = new Map<string, PrincipalGroup>();

  const visitors = snap.principals.filter((p) => p.kind === "visitor");
  const people = snap.principals.filter((p) => p.kind !== "visitor");
  const groupVisitors = visitors.length > VISITORS_INLINE || snap.visitorCount > visitors.length;

  const addGroup = (id: string, members: CityPrincipal[], kind: PrincipalGroup["kind"]) => {
    const rail = railOfJurisdiction(members[0]!.jurisdiction);
    const g: PrincipalGroup = { id, rail, principal: `p:${id}`, agent: `a:${id}`, kind, order: 0 };
    groups.push(g);
    for (const m of members) groupOfPrincipal.set(m.id, g);
    const first = members[0]!;
    const agentPassports = new Set(members.map((m) => m.agent.passport));
    const passport: CityPassport = agentPassports.size === 1 ? first.agent.passport : agentPassports.has("halted") ? "halted" : "attested";
    nodes.set(g.principal, {
      kind: "principal",
      id: g.principal,
      rail,
      group: id,
      title: kind === "visitors" ? "Visitors" : first.name,
      subtitle:
        kind === "visitors"
          ? `${Math.max(snap.visitorCount, members.length)} signed up with a passkey`
          : kind === "company"
            ? `Company · ${first.signer}`
            : `Person · ${first.signer}`,
      glyph: kind === "visitors" ? "visitors" : kind === "company" ? "company" : "person",
      principals: members,
      receipts: [],
      counts: zero(),
    });
    nodes.set(g.agent, {
      kind: "agent",
      id: g.agent,
      rail,
      group: id,
      title: kind === "visitors" ? `${members.length === 1 ? first.agent.label : "Visitor agents"}` : first.agent.label,
      subtitle:
        kind === "visitors"
          ? `${members.length} passports listed`
          : first.agent.identityCode
            ? `Passport ${first.agent.identityCode}`
            : `Agent ${first.agent.agentId}`,
      glyph: passport,
      principals: members,
      sharedWith: [],
      receipts: [],
      counts: zero(),
    });
    return g;
  };

  for (const p of people) addGroup(p.id, [p], p.kind === "company" ? "company" : "person");
  if (groupVisitors && visitors.length) {
    // One group per rail the visitors' mandates are sealed for (normally one).
    for (const rail of ["hk", "fisco"] as const) {
      const members = visitors.filter((v) => railOfJurisdiction(v.jurisdiction) === rail);
      if (members.length) addGroup(rail === "hk" ? "visitors" : "visitors-sz", members, "visitors");
    }
  } else {
    for (const v of visitors) addGroup(v.id, [v], "person");
  }
  const visitorGroup = groups.find((g) => g.kind === "visitors") ?? null;

  // Same passport on two mandates (the same agent identity acting for two principals).
  for (const g of groups) {
    const a = nodes.get(g.agent) as AgentNode;
    if (g.kind === "visitors") continue;
    const me = a.principals[0]!;
    a.sharedWith = groups
      .filter((o) => o !== g && o.kind !== "visitors")
      .filter((o) => {
        const other = (nodes.get(o.agent) as AgentNode).principals[0]!;
        return other.agent.agentId === me.agent.agentId && lc(other.agent.wallet) === lc(me.agent.wallet);
      })
      .map((o) => o.id);
  }

  // Sort groups in each plane: companies next to the seam (bottom of the Shenzhen plane, top of the HK
  // plane), an identity shared across the seam closest to it, visitors furthest away.
  const rank = (g: PrincipalGroup) => {
    const a = nodes.get(g.agent) as AgentNode;
    const crosses = a.sharedWith.some((id) => groups.find((x) => x.id === id)?.rail !== g.rail);
    return (g.kind === "visitors" ? 3 : g.kind === "person" ? 2 : 1) - (crosses ? 0.5 : 0);
  };
  for (const g of groups) g.order = rank(g);
  groups.sort((a, b) => a.order - b.order || (nodes.get(a.principal)!.title.localeCompare(nodes.get(b.principal)!.title)));

  // Counterparties: payee books first, then receipt payees (merged by address), then registry agents.
  const byAddress = new Map<string, CounterpartyNode>();
  const byLabel = new Map<string, CounterpartyNode>();
  const registryAt = new Map(snap.agents.map((a) => [a.wallet.toLowerCase(), a]));
  const agentWallet = new Map<string, PrincipalGroup>();
  for (const g of groups) for (const p of (nodes.get(g.agent) as AgentNode).principals) agentWallet.set(p.agent.wallet.toLowerCase(), g);

  const counterparty = (label: string, address: string | null, rail: Rail, category: string | null): CounterpartyNode => {
    const key = lc(address);
    const hit = key ? byAddress.get(key) : byLabel.get(label.toLowerCase());
    if (hit) {
      if (!hit.category && category) hit.category = category;
      return hit;
    }
    const reg = key ? (registryAt.get(key) ?? null) : null;
    const split = splitLabel(reg?.label ?? label);
    const node: CounterpartyNode = {
      kind: "counterparty",
      id: `c:${key ?? label.toLowerCase().replace(/\s+/g, "-")}`,
      rail,
      title: split.title,
      subtitle: split.note ?? "",
      glyph: reg ? reg.passport : "unverified",
      address,
      category,
      listedBy: [],
      registered: reg,
      ledgers: [],
      receipts: [],
      counts: zero(),
    };
    nodes.set(node.id, node);
    if (key) byAddress.set(key, node);
    byLabel.set(label.toLowerCase(), node);
    return node;
  };

  for (const g of groups) {
    for (const p of (nodes.get(g.agent) as AgentNode).principals) {
      for (const pay of p.payees) {
        const c = counterparty(pay.label, pay.address, g.rail, pay.category);
        if (!c.listedBy.includes(p.id)) c.listedBy.push(p.id);
        if (!c.registered) c.glyph = "payee";
      }
    }
  }

  // Receipts: live ledgers only; each one lands on exactly one edge.
  const receipts = snap.feed.receipts.filter((r) => r.ledger !== "anvil-bench");
  const edges = new Map<string, CityEdge>();
  const edgeOfReceipt = new Map<string, string>();
  const mandateEdge = (g: PrincipalGroup) => {
    const id = `m:${g.id}`;
    let e = edges.get(id);
    if (!e) {
      const members = (nodes.get(g.agent) as AgentNode).principals;
      const live = members.some((m) => m.mandate?.status === "live");
      const status = live ? "live" : (members[0]?.mandate?.status ?? "none");
      e = { id, kind: "mandate", from: g.principal, to: g.agent, rail: g.rail, state: "settled", receipts: [], mandate: status };
      edges.set(id, e);
    }
    return e;
  };
  for (const g of groups) mandateEdge(g);

  const groupOf = (r: CityReceipt): PrincipalGroup | null =>
    groupOfPrincipal.get(r.principal) ?? (visitorGroup && r.principal.startsWith("v-") ? visitorGroup : null);

  const shown: CityReceipt[] = [];
  for (const r of receipts) {
    const g = groupOf(r);
    const s = stateOf(r);
    if (!g || !s) continue;
    shown.push(r);
    const agent = nodes.get(g.agent)!;
    agent.receipts.push(r);
    agent.counts[s] += 1;
    if (!isPayment(r)) {
      const e = mandateEdge(g);
      e.receipts.push(r);
      edgeOfReceipt.set(r.receiptId, e.id);
      const p = nodes.get(g.principal)!;
      p.receipts.push(r);
      continue;
    }
    // A payment to another listed agent's wallet lands on that agent; anything else on a counterparty.
    const toAgent = r.payee!.address ? agentWallet.get(r.payee!.address.toLowerCase()) : undefined;
    const target = toAgent && toAgent !== g ? nodes.get(toAgent.agent)! : counterparty(r.payee!.label, r.payee!.address, g.rail, null);
    if (target.kind === "counterparty" && !target.ledgers.includes(r.ledger)) target.ledgers.push(r.ledger);
    const id = `pay:${g.id}>${target.id}:${s}`;
    let e = edges.get(id);
    if (!e) {
      e = { id, kind: "payment", from: g.agent, to: target.id, rail: g.rail, state: s, receipts: [] };
      edges.set(id, e);
    }
    e.receipts.push(r);
    edgeOfReceipt.set(r.receiptId, id);
    if (target !== agent) {
      target.receipts.push(r);
      target.counts[s] += 1;
    }
  }

  // A counterparty paid from both planes sits on the plane that pays it most.
  for (const n of nodes.values()) {
    if (n.kind !== "counterparty") continue;
    const per: Record<Rail, number> = { fisco: 0, hk: 0 };
    for (const e of edges.values()) if (e.to === n.id && e.rail !== "seam") per[e.rail] += e.receipts.length;
    for (const pid of n.listedBy) {
      const g = groupOfPrincipal.get(pid);
      if (g) per[g.rail] += 0.5;
    }
    if (per.fisco !== per.hk) n.rail = per.fisco > per.hk ? "fisco" : "hk";
    if (!n.subtitle && n.category) n.subtitle = n.category;
  }

  // Registry agents nobody pays or lists (for example a self-registered identity) still appear.
  for (const a of snap.agents) {
    if (byAddress.has(a.wallet.toLowerCase())) continue;
    counterparty(a.label, a.wallet, a.ledger === "fisco" ? "fisco" : "hk", null);
  }

  // Identity links: one per pair of groups sharing a passport.
  for (const g of groups) {
    const a = nodes.get(g.agent) as AgentNode;
    for (const other of a.sharedWith) {
      const o = groups.find((x) => x.id === other)!;
      const [x, y] = [g, o].sort((p, q) => (p.rail === q.rail ? p.id.localeCompare(q.id) : p.rail === "fisco" ? -1 : 1));
      const id = `id:${x!.id}~${y!.id}`;
      if (!edges.has(id)) edges.set(id, { id, kind: "identity", from: x!.agent, to: y!.agent, rail: x!.rail === y!.rail ? x!.rail : "seam", state: "settled", receipts: [] });
    }
  }

  // Ledger elements: the regulator (FISCO observer node) and one anchor per side of the seam.
  const fiscoHealth = snap.ledgers.find((l) => l.ledger === "fisco") ?? null;
  nodes.set("regulator", {
    kind: "regulator",
    id: "regulator",
    rail: "fisco",
    title: "Regulator node",
    subtitle: fiscoHealth?.ok ? (fiscoHealth.block ? `FISCO observer · block ${fiscoHealth.block}` : "FISCO observer") : "FISCO observer · not reachable",
    glyph: "regulator",
    ledger: fiscoHealth,
    receipts: [],
    counts: zero(),
  });
  for (const rail of ["fisco", "hk"] as const) {
    const ledger = RAIL_LEDGER[rail];
    const batches = snap.feed.batches.filter((b) => b.anchors.some((a) => a.ledger === ledger)).sort((a, b) => b.batchId - a.batchId);
    const health = snap.ledgers.find((l) => l.ledger === ledger);
    const badge = health?.badge ?? (ledger === "fisco" ? "FISCO BCOS" : "Base Sepolia");
    const short = ledger === "fisco" ? "FISCO BCOS" : "Base Sepolia";
    nodes.set(`anchor:${ledger}`, {
      kind: "anchor",
      id: `anchor:${ledger}`,
      rail,
      title: `${ledger === "fisco" ? "FISCO" : short} anchor`,
      subtitle: !snap.feed.batchesReadable
        ? "Batches not readable here"
        : batches.length
          ? `${batches.length} batch${batches.length === 1 ? "" : "es"} · ${batches.reduce((n, b) => n + b.count, 0)} receipts`
          : "No batch anchored yet",
      glyph: batches.length ? "anchor" : "anchor-empty",
      ledger,
      badge,
      batches,
      receipts: [],
      counts: zero(),
    });
  }
  edges.set("anchor:seam", { id: "anchor:seam", kind: "anchor", from: "anchor:fisco", to: "anchor:base-sepolia", rail: "seam", state: "settled", receipts: [] });
  edges.set("observe", { id: "observe", kind: "observe", from: "regulator", to: "anchor:fisco", rail: "fisco", state: "settled", receipts: [] });

  // Rail ledgers actually used (honest header chips: a rail profile may run on another ledger for now).
  const rails: Record<Rail, RailInfo> = { fisco: { rail: "fisco", ledgers: [] }, hk: { rail: "hk", ledgers: [] } };
  for (const g of groups) {
    for (const p of (nodes.get(g.agent) as AgentNode).principals) {
      const info = rails[g.rail];
      if (!info.ledgers.some((l) => l.ledger === p.ledger)) info.ledgers.push({ ledger: p.ledger, badge: p.ledgerBadge ?? p.ledger });
    }
  }

  for (const n of nodes.values()) n.receipts.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  for (const e of edges.values()) e.receipts.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  for (const n of nodes.values()) if (n.kind === "principal") n.counts = countStates(n.receipts);

  return {
    nodes,
    edges: [...edges.values()],
    groups,
    rails,
    receipts: shown.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)),
    batches: [...snap.feed.batches].sort((a, b) => b.batchId - a.batchId),
    batchesReadable: snap.feed.batchesReadable,
    edgeOfReceipt,
    visitorCount: snap.visitorCount,
  };
}

/** Everything one element touches, for highlighting on hover and selection. */
export function neighbourhood(model: CityModel, id: string): Set<string> {
  const out = new Set<string>([id]);
  const edge = model.edges.find((e) => e.id === id);
  if (edge) {
    out.add(edge.from);
    out.add(edge.to);
    return out;
  }
  for (const e of model.edges) {
    if (e.from === id || e.to === id) {
      out.add(e.id);
      out.add(e.from);
      out.add(e.to);
    }
  }
  // A principal highlights its agent's payments too, and an agent its principal.
  const n = model.nodes.get(id);
  if (n && (n.kind === "principal" || n.kind === "agent")) {
    const g = model.groups.find((x) => x.id === n.group)!;
    for (const e of model.edges) {
      if (e.from === g.agent || e.to === g.agent) {
        out.add(e.id);
        out.add(e.to);
        out.add(e.from);
      }
    }
  }
  return out;
}
