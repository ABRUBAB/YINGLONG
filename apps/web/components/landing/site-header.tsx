/**
 * Retired. The global navigation bar now lives in the root layout (components/shell/site-nav.tsx)
 * and renders on every route. This export stays as a no-op so pages that still import it (Agent
 * City, rebuilt separately) keep compiling and do not render a second header. Remove the import
 * when you next touch such a page.
 */
export function SiteHeader(_props: { obsidian?: boolean; className?: string } = {}) {
  return null;
}
