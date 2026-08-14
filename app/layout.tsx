import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://your-domain.example"),
  title: "Robert Tacchini — Seller Reputation Profile",
  description: "Verify Robert Tacchini's seller reputation, completed deals, buyer references, and official trading accounts.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: { title: "Robert Tacchini — Seller Reputation Profile", description: "Completed deals, public references, and official trading accounts.", type: "website", images: [{ url: "/og.png", width: 1792, height: 1024, alt: "Robert Tacchini seller reputation profile" }] },
  twitter: { card: "summary_large_image", title: "Robert Tacchini — Seller Reputation Profile", description: "Completed deals, public references, and official trading accounts.", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
