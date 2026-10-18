/**
 * Team Shadow Chaser (Bangladesh). Rendered by /about.
 *
 * Names and roles come from the registration form; the portraits were supplied by the lead
 * (public/team, cropped 4:5). Never invent names, photos, universities, roles or quotes: a member who is
 * not listed is simply not shown.
 */
export interface TeamMember {
  name: string;
  /** Short role, shown on the portrait. */
  role: string;
  /** One plain sentence: what this person builds. */
  bio: string;
  /** Portrait under /public, 640 x 800. */
  photo: string;
  /** Card colour: one of the accent family (globals.css, tokens.mjs). */
  tone: "accent" | "lime" | "violet" | "cyan" | "amber";
  /** Optional public profile links, shown as text links. */
  links?: { label: string; href: string }[];
  lead?: boolean;
}

export const TEAM = {
  name: "Shadow Chaser",
  country: "Bangladesh",
  members: [
    {
      name: "Abdullah Rubab",
      role: "Team lead, AI and ML",
      bio: "Leads the build and the submission, designs the AI and machine-learning parts, and owns the agent service and the evidence.",
      photo: "/team/p1c.webp",
      tone: "accent",
      lead: true,
      links: [{ label: "GitHub", href: "https://github.com/ABRUBAB" }],
    },
    {
      name: "Md. Sadman Al Islam Shabab",
      role: "Contracts, ledgers and AI",
      bio: "Writes the rule contracts for both blockchains and the evidence behind every claim.",
      photo: "/team/p2.webp",
      tone: "lime",
    },
    {
      name: "Tanvir Hossin",
      role: "Agent runtime",
      bio: "Builds the agent, the signer and the services that connect them to the chains.",
      photo: "/team/p3.webp",
      tone: "violet",
    },
    {
      name: "Md. Omar Faruk",
      role: "AI security and ML",
      bio: "Trains and tests the AI screen, and runs the attack bench against it.",
      photo: "/team/p4.webp",
      tone: "cyan",
    },
    {
      name: "Amzad Hossen Rifat",
      role: "Front end, UX and media",
      bio: "Designs the website, the demo screens and the video.",
      photo: "/team/p5.webp",
      tone: "amber",
    },
  ] satisfies TeamMember[],
} as const;
