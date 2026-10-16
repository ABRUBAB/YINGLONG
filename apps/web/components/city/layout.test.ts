/** Agent City: the graph comes from the snapshot only, and the layout never lets two labels overlap. */
import { describe, expect, it } from "vitest";
import { citySnapshot } from "@/lib/api/fixtures/city";
import type { CityPrincipal, CityReceipt, CitySnapshot } from "@/lib/api/view";
import { layoutCity, overlaps, type Box, type Layout } from "./layout";
import { buildCity } from "./model";

const WIDTHS = [341, 500, 640, 736, 870, 904, 1000, 1180];

function labelBoxes(l: Layout): { id: string; box: Box }[] {
  const out = l.drawn.map((id) => ({ id, box: l.boxes.get(id)! }));
  for (const g of l.edges.values()) {
    if (g.pill) out.push({ id: `pill:${g.id}`, box: g.pill });
    if (g.chip) out.push({ id: `chip:${g.id}`, box: g.chip });
  }
  for (const r of ["fisco", "hk"] as const) out.push({ id: `header:${r}`, box: l.planeHeaders[r] });
  for (const c of l.colHeaders) out.push({ id: `col:${c.rail}:${c.col}`, box: c.box });
  if (l.seamLabel) out.push({ id: "seam", box: l.seamLabel });
  return out;
}

function assertClean(l: Layout) {
  const boxes = labelBoxes(l);
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i]!;
    expect(a.box.x, `${a.id} starts inside the map`).toBeGreaterThanOrEqual(0);
    expect(a.box.x + a.box.w, `${a.id} ends inside the map`).toBeLessThanOrEqual(l.width + 0.5);
    for (let j = i + 1; j < boxes.length; j++) {
      const b = boxes[j]!;
      expect(overlaps(a.box, b.box), `${a.id} overlaps ${b.id}`).toBe(false);
    }
  }
}

/** A busier city than the sample: many visitors, payees and refusals. */
function stress(): CitySnapshot {
  const base = structuredClone(citySnapshot);
  const nadia = base.principals[0]!;
  const extraPayees = Array.from({ length: 14 }, (_, i) => ({
    label: `Merchant number ${i + 1} with a rather long trading name`,
    address: `0x${(i + 1).toString(16).padStart(40, "a")}`,
    category: i % 2 ? "food" : "services",
  }));
  nadia.payees.push(...extraPayees);
  const visitors: CityPrincipal[] = Array.from({ length: 7 }, (_, i) => ({
    ...structuredClone(base.principals.find((p) => p.kind === "visitor")!),
    id: `v-stress${i}`,
    name: `Visitor S${i}`,
  }));
  base.principals.push(...visitors);
  base.visitorCount = 9;
  const tmpl = base.feed.receipts[0]!;
  const rs: CityReceipt[] = [];
  extraPayees.forEach((p, i) => {
    for (const outcome of ["confirmed", "rejected_policy", "awaiting_approval"] as const) {
      if ((i + outcome.length) % 3 === 0) continue;
      rs.push({ ...tmpl, receiptId: `${tmpl.receiptId}-${i}-${outcome}`, principal: i % 4 === 0 ? `v-stress${i % 7}` : "nadia", outcome, payee: { label: p.label, address: p.address } });
    }
  });
  base.feed.receipts.push(...rs);
  return base;
}

describe("Agent City model", () => {
  const m = buildCity(citySnapshot);

  it("builds every element from the snapshot", () => {
    expect(m.groups.map((g) => g.id).sort()).toEqual(citySnapshot.principals.map((p) => p.id).sort());
    // Shenzhen principals sit on the coin-free rail, everyone else on the HK test rail.
    for (const g of m.groups) {
      const p = citySnapshot.principals.find((x) => x.id === g.id)!;
      expect(g.rail).toBe(p.jurisdiction === "mainland" ? "fisco" : "hk");
    }
    // The self-registered registry entry appears with its dashed passport ring.
    const rogue = [...m.nodes.values()].find((n) => n.kind === "counterparty" && n.glyph === "self-registered");
    expect(rogue?.title).toBe(citySnapshot.agents.find((a) => a.passport === "self-registered")!.label);
    // Each receipt lands on exactly one edge, and a refusal never shows as settled.
    for (const r of m.receipts) {
      const e = m.edges.find((x) => x.id === m.edgeOfReceipt.get(r.receiptId))!;
      expect(e.receipts).toContain(r);
      if (r.outcome === "reverted" || r.outcome === "rejected_policy") expect(e.kind === "payment" ? e.state : "refused").toBe("refused");
    }
    // The treasurer's one passport on two mandates crosses the seam.
    expect(m.edges.some((e) => e.kind === "identity" && e.rail === "seam")).toBe(true);
    expect(m.nodes.get("regulator")?.kind).toBe("regulator");
    expect(m.nodes.get("anchor:fisco")?.kind).toBe("anchor");
  });

  it("groups visitors when there are many", () => {
    const s = buildCity(stress());
    expect(s.groups.filter((g) => g.kind === "visitors")).toHaveLength(1);
  });
});

describe("Agent City layout", () => {
  for (const w of WIDTHS) {
    it(`has no overlapping labels at ${w}px (sample)`, () => assertClean(layoutCity(buildCity(citySnapshot), w)));
    it(`has no overlapping labels at ${w}px (stress)`, () => assertClean(layoutCity(buildCity(stress()), w)));
  }

  it("is deterministic", () => {
    const a = layoutCity(buildCity(citySnapshot), 1000);
    const b = layoutCity(buildCity(citySnapshot), 1000);
    expect([...a.boxes.entries()]).toEqual([...b.boxes.entries()]);
  });

  it("puts Shenzhen north of the seam and Hong Kong south of it", () => {
    const l = layoutCity(buildCity(citySnapshot), 1000);
    expect(l.planes.fisco.y + l.planes.fisco.h).toBeLessThanOrEqual(l.seam.y);
    expect(l.planes.hk.y).toBeGreaterThanOrEqual(l.seam.y + l.seam.h);
  });
});
