import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://reverlo.nl"),
  title: "Reverlo — Independent Reputation Profile",
  description: "Verify seller reputation through moderated buyer reviews and official social profiles.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: { title: "Reverlo — Independent Reputation Profile", description: "Moderated buyer references and official social profiles.", type: "website", images: [{ url: "/og.png", width: 1792, height: 1024, alt: "Reverlo reputation profile" }] },
  twitter: { card: "summary_large_image", title: "Reverlo — Independent Reputation Profile", description: "Moderated buyer references and official social profiles.", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
