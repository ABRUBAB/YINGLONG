/** Every route the app serves, with the heading each one must show. */
export const ROUTES = [
  { path: "/", name: "home", heading: /Always with you/ },
  { path: "/app", name: "app", heading: /Nadia Rahman/ },
  { path: "/app/mandates/new", name: "studio", heading: /Say it\. See it\. Seal it\./ },
  { path: "/treasury", name: "treasury", heading: /Lotus Lane/ },
  { path: "/supervisor", name: "supervisor", heading: /Agent registry/ },
  { path: "/proof", name: "proof", heading: /What is proven/ },
  { path: "/approve/apr-tuition", name: "approve", heading: /Approve/ },
  { path: "/challenge", name: "challenge", heading: /Nothing you type can move funds/ },
  { path: "/city", name: "city", heading: /Two rails, one engine/ },
  { path: "/start", name: "start", heading: /Get your own AI agent in three steps/ },
  { path: "/about", name: "about", heading: /An agent wallet/ },
] as const;

export const WIDTHS = [375, 768, 1440] as const;

/** Console noise that is not ours (three.js deprecation notices and driver shader warnings). */
export const IGNORED_CONSOLE = [/THREE\./, /SVGLoader/, /X4122/, /WebGL/, /GPU stall/, /Program Info Log/];
