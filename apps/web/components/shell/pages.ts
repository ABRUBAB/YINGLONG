/** Every page of the site, in reading order. The top nav, the mobile sheet and the footer share it. */
export const SITE_PAGES = [
  { href: "/", label: "Home", hint: "What YINGLONG is, in one scroll" },
  { href: "/app", label: "Console", hint: "Nadia's agent, approvals and receipts" },
  { href: "/treasury", label: "Treasury", hint: "Lotus Lane's board-mandated treasurer" },
  { href: "/supervisor", label: "Supervisor", hint: "Registry, Merkle verification, pause only" },
  { href: "/city", label: "Agent City", hint: "Two rails, one engine, live" },
  { href: "/proof", label: "Proof", hint: "Every number with its source" },
  { href: "/challenge", label: "Judge's Challenge", hint: "Try to move funds outside a mandate" },
  { href: "/about", label: "About", hint: "Team Shadow Chaser and the competition" },
] as const;

export const SIGN_UP = { href: "/start", label: "Sign up with your passkey" } as const;

export function pageActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
