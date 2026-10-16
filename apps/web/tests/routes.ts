/** Every route the app serves, with the heading each one must show. */
export const ROUTES = [
  { path: "/", name: "home", heading: /Always with you/ },
  { path: "/app", name: "app", heading: /Nadia Rahman/ },
  { path: "/treasury", name: "treasury", heading: /Lotus Lane/ },
  { path: "/supervisor", name: "supervisor", heading: /Every AI agent, who it works for/ },
  { path: "/proof", name: "proof", heading: /Real blockchain records you can check yourself/ },
  { path: "/approve/apr-tuition", name: "approve", heading: /Approve/ },
  { path: "/challenge", name: "challenge", heading: /Try to trick the agent/ },
  { path: "/city", name: "city", heading: /Every agent and payment, live/ },
  { path: "/start", name: "start", heading: /Get your own AI agent in three steps/ },
  { path: "/about", name: "about", heading: /An AI agent that pays for you/ },
] as const;

export const WIDTHS = [375, 768, 1440] as const;

/** Console noise that is not ours (three.js deprecation notices and driver shader warnings). */
export const IGNORED_CONSOLE = [/THREE\./, /SVGLoader/, /X4122/, /WebGL/, /GPU stall/, /Program Info Log/];
