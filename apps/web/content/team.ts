/**
 * Team Shadow Chaser (Bangladesh). Rendered by /about.
 *
 * Only facts the lead has confirmed go here. Never invent names, photos, universities, roles or
 * quotes: a member who is not listed is simply not shown.
 */
export interface TeamMember {
  name: string;
  role: string;
  /** Optional public profile links, shown as text links. */
  links?: { label: string; href: string }[];
  lead?: boolean;
}

export const TEAM = {
  name: "Shadow Chaser",
  country: "Bangladesh",
  members: [
    {
      name: "ABRUBAB",
      role: "Team lead",
      lead: true,
      links: [{ label: "GitHub", href: "https://github.com/ABRUBAB" }],
    },
    // TODO(lead): add the other team members here once confirmed (name, role, optional links).
    // Do not add placeholder names; the About page shows exactly the members listed in this array.
  ] satisfies TeamMember[],
} as const;
