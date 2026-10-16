/** Joins class names, skipping falsy values. (No tailwind-merge: ORBIT classes never conflict by design.) */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Round to 3 decimals so server and browser render identical SVG (Math.cos/sin can differ in the last bit). */
export const f3 = (n: number): number => Math.round(n * 1000) / 1000;

/** 0x1234…abcd */
export function shortHash(hash: string, head = 6, tail = 4): string {
  if (!hash) return "";
  if (hash.length <= head + tail + 2) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}
