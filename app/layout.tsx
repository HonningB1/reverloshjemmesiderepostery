import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://reverlo.nl"),
  applicationName: "Reverlo",
  manifest: "/site.webmanifest",
  title: "Reverlo — Verified Trading Reputation",
  description: "View verified feedback and trading history for Reverlo across eBay and direct transactions.",
  icons: {
    icon: [
      { url: "/favicon-16.png", type: "image/png", sizes: "16x16" },
      { url: "/favicon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/reverlo-icon.png", type: "image/png", sizes: "512x512" },
    ],
    shortcut: ["/favicon-32.png"],
    apple: [{ url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" }],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
