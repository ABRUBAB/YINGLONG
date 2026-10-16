/** Every page of the site, in reading order. The top nav, the mobile sheet and the footer share it. */
export const SITE_PAGES = [
  { href: "/", label: "Home", hint: "Start here: what this site does" },
  { href: "/app", label: "Student demo", hint: "Nadia's AI agent pays her bills inside her rules" },
  { href: "/treasury", label: "Company demo", hint: "A company's AI treasurer, with directors' approval" },
  { href: "/supervisor", label: "Regulator", hint: "What a regulator sees, and how it can pause an agent" },
  { href: "/city", label: "Live map", hint: "Every agent and payment, as they happen" },
  { href: "/proof", label: "Proof", hint: "Real blockchain records anyone can check" },
  { href: "/challenge", label: "Try to hack it", hint: "Try to trick an agent into sending money it should not" },
  { href: "/about", label: "About", hint: "Who we are and how it works" },
] as const;

export const SIGN_UP = { href: "/start", label: "Create your agent" } as const;
export const MY_AGENT = { href: "/app", label: "My agent" } as const;

export function pageActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
