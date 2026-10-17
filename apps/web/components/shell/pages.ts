/** Primary destinations. The demos and technical pages live in the menu under their intent. */
export const SITE_PAGES = [
  { href: "/", label: "Home", hint: "Start here: what this site does" },
  { href: "/city", label: "Live map", hint: "Every agent and payment, as they happen" },
  { href: "/proof", label: "Proof", hint: "Real blockchain records anyone can check" },
  { href: "/about", label: "About", hint: "Who we are and how it works" },
] as const;

export const TRY_PAGES = [
  { href: "/judge", label: "3-minute walkthrough", hint: "See a payment, a refusal, and their records" },
  { href: "/app", label: "Student demo", hint: "Nadia's agent and its spending rules" },
  { href: "/treasury", label: "Company demo", hint: "Supplier payments with director approval" },
  { href: "/start", label: "Create your agent", hint: "Try it with a passkey and test units" },
] as const;

export const EXPLORE_PAGES = [
  { href: "/supervisor", label: "Regulator view", hint: "Inspect agents and pause authority" },
  { href: "/challenge", label: "Security challenge", hint: "Try to get an agent past its rules" },
] as const;

export const DESKTOP_PAGES = [
  { href: "/", label: "Home" },
  { href: "/judge", label: "Walkthrough" },
  { href: "/app", label: "Student" },
  { href: "/treasury", label: "Company" },
  { href: "/supervisor", label: "Regulator" },
  { href: "/city", label: "Live map" },
  { href: "/proof", label: "Proof" },
  { href: "/challenge", label: "Challenge" },
  { href: "/about", label: "About" },
] as const;

export const SIGN_UP = { href: "/start", label: "Create your agent" } as const;
export const MY_AGENT = { href: "/app", label: "My agent" } as const;

export function pageActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
