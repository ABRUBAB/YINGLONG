import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

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
  themeColor: "#0B0C0F",
  colorScheme: "dark light",
  width: "device-width",
  initialScale: 1,
};

// Applies the saved theme and motion preference before first paint (wrapped: storage may be blocked).
const PREFS = `try{var d=document.documentElement,t=localStorage.getItem("yl-theme"),m=localStorage.getItem("yl-motion");if(t==="light"||t==="dark")d.dataset.theme=t;if(m==="off")d.dataset.motion="off";}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PREFS }} />
        <link rel="preload" href="/fonts/Geist-Latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/HubotSans-Latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body>
        <a href="#main" className="yl-skip">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
