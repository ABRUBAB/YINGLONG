/** The nine checks in plain words, shared by the Rules Lab and the 3D nine-gates stage. */
export const GATES_COPY = [
  { name: "Normalise", plain: "Cleans the request: hidden characters and look-alike letters are removed." },
  { name: "Sentinel", plain: "An AI screen looks for tricks like “ignore your rules”. It can warn. It can never approve." },
  { name: "Quarantine", plain: "Anything from outside, like an invoice or an email, goes in a sealed box. It can be read, never obeyed." },
  { name: "Ground", plain: "The amount must come from your own words, not from the agent's guess." },
  { name: "Policy", plain: "Your rules, checked by plain code: limits, allowed payees and who needs to approve." },
  { name: "Counterparty", plain: "Is the payee known? Does the address look like someone else's? Is it on a block list?" },
  { name: "Simulate", plain: "A dry run on the blockchain first. If it would fail, it is never sent." },
  { name: "Anomaly", plain: "Is this much bigger than usual for this payee? Then you decide." },
  { name: "Chain", plain: "The blockchain checks every rule again. This is the last wall and it cannot be talked round." },
] as const;
