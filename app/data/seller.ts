export const seller = {
  name: "Robert Tacchini",
  initials: "RT",
  location: "Denmark",
  availability: "Active seller",
  since: "2022",
  stats: [
    { label: "Completed deals", value: "52+", detail: "Direct & marketplace" },
    { label: "Total value traded", value: "€18K+", detail: "Across completed deals" },
    { label: "Positive feedback", value: "100%", detail: "Reported reputation" },
    { label: "Countries traded with", value: "8", detail: "Across Europe" },
  ],
} as const;

// Replace the URLs below with Robert's official profiles before publishing.
export const profiles = [
  { platform: "eBay", handle: "your-ebay-username", url: "https://www.ebay.com/", kind: "Marketplace profile" },
  { platform: "X", handle: "@your-handle", url: "https://x.com/", kind: "Official account" },
  { platform: "Discord", handle: "your.username", url: "https://discord.com/", kind: "Official account" },
  { platform: "Other platform", handle: "Add a profile", url: "https://example.com/", kind: "Future verification" },
] as const;

export type Deal = {
  id: string;
  product: string;
  quantity: number;
  price: string;
  buyer: string;
  origin: string;
  destination: string;
  date: string;
  status: "Delivered" | "Completed";
  proofUrl?: string;
  comment?: string;
};

// Sample records: replace with real completed deals only. Never include private buyer data.
export const deals: Deal[] = [
  { id: "RTC-0001", product: "Starlink Mini", quantity: 3, price: "€781", buyer: "B2B buyer", origin: "Denmark", destination: "Germany", date: "14 Aug 2026", status: "Delivered", proofUrl: "https://example.com/" },
  { id: "RTC-0002", product: "Collectible electronics", quantity: 1, price: "€420", buyer: "Private buyer", origin: "Denmark", destination: "Sweden", date: "03 Aug 2026", status: "Delivered", proofUrl: "https://example.com/" },
  { id: "RTC-0003", product: "Tech accessory bundle", quantity: 6, price: "€645", buyer: "Repeat buyer", origin: "Denmark", destination: "Netherlands", date: "21 Jul 2026", status: "Completed" },
];

export type Vouch = {
  buyer: string;
  platform: string;
  date: string;
  dealId: string;
  comment: string;
  url?: string;
};

// Sample references: link to the original vouch whenever a public link exists.
export const vouches: Vouch[] = [
  { buyer: "@buyer_handle", platform: "eBay", date: "Aug 2026", dealId: "RTC-0001", comment: "Replace with a genuine buyer reference and its public source link.", url: "https://example.com/" },
  { buyer: "@buyer_handle", platform: "Discord", date: "Jul 2026", dealId: "RTC-0003", comment: "Add only feedback the buyer has agreed to have displayed publicly.", url: "https://example.com/" },
];
