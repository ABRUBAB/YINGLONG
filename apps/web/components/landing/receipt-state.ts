import type { RingState } from "@yinglong/ui";
import type { Receipt } from "@/lib/api/view";

/** One word and one glyph state per receipt outcome, shared by the hero chips and the live ticker. */
export function receiptState(outcome: Receipt["outcome"]): { state: RingState; word: string } {
  switch (outcome) {
    case "confirmed":
      return { state: "onchain", word: "Paid" };
    case "reverted":
      return { state: "refused", word: "Blocked on chain" };
    case "rejected_policy":
      return { state: "refused", word: "Refused" };
    case "asked":
      return { state: "asking", word: "Asked the owner" };
    case "awaiting_approval":
    case "pending":
      return { state: "waiting", word: "Waiting for approval" };
    default:
      return { state: "unknown", word: "Recorded" };
  }
}
