import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { SessionSync } from "@/components/session";
import { SiteNav } from "@/components/shell/site-nav";
import { SiteFooter } from "@/components/shell/site-footer";
import { FxLayer } from "@/components/fx/fx-layer";
import { BootScreen } from "@/components/brand/loader";
import { BootControl } from "@/components/fx/boot-control";
import { FaqChat } from "@/components/support/faq-chat";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://app.yinglong-agent.tech"),
  title: { default: "YINGLONG: Personal Agent Identity & Mandated Finance", template: "%s | YINGLONG" },
  description:
    "An AI agent that acts on your money only as you, only inside the mandate you sealed, and always with proof. Always with you. Never beyond your mandate.",
  applicationName: "YINGLONG",
  robots: { index: true, follow: true },
  openGraph: {
    title: "YINGLONG",
    description: "Personal Agent Identity & Mandated Finance. Always with you. Never beyond your mandate.",
    images: [{ url: "/posters/og.webp", width: 1200, height: 630 }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F3F2EE" },
    { media: "(prefers-color-scheme: dark)", color: "#0B0C0F" },
  ],
  colorScheme: "dark light",
  width: "device-width",
  initialScale: 1,
};

// Applies the saved theme and motion preference before first paint (wrapped: storage may be blocked). Without a
// saved theme the device setting decides (tokens.css, prefers-color-scheme).
const PREFS = `try{var d=document.documentElement,t=localStorage.getItem("yl-theme"),m=localStorage.getItem("yl-motion");if(t==="light"||t==="dark")d.dataset.theme=t;d.classList.toggle("dark",t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches));if(m==="off")d.dataset.motion="off";if(!sessionStorage.getItem("yl-boot")&&!navigator.webdriver&&!matchMedia("(prefers-reduced-motion: reduce)").matches&&m!=="off"){d.dataset.boot="1";}}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PREFS }} />
        <link rel="preload" href="/fonts/Geist-Latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/HubotSans-Latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body>
        <a href="#main" className="yl-skip">
          Skip to content
        </a>
        <BootScreen />
        <BootControl />
        <FxLayer />
        <SiteNav />
        {children}
        <SiteFooter />
        <SessionSync />
        <FaqChat />
      </body>
    </html>
  );
}
