import { redirect } from "next/navigation";

/** Writing new rules lives on /start (write, check, lock); this older address forwards there. */
export default function MandateStudioPage() {
  redirect("/start?again=1");
}
