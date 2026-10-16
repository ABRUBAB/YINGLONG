import type { Metadata } from "next";
import { Suspense } from "react";
import { SiteHeader } from "@/components/landing/site-header";
import { Start } from "@/components/start/start";

export const metadata: Metadata = {
  title: "Try it with your own passkey",
  description: "Create a passkey, read the two messages it signs, and seal your own agent's mandate. Test units only; the passkey never leaves your device.",
};

export default function StartPage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <Suspense>
          <Start />
        </Suspense>
      </main>
    </>
  );
}
