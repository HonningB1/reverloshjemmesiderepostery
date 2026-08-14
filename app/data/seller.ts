// Identity details are maintained separately from the D1-backed reputation data.
export const seller = {
  name: "Robert Tacchini",
  initials: "RT",
  location: "Denmark",
  availability: "Active seller",
  since: "2022",
} as const;

// Add official profiles only when their public URLs are ready to be verified.
export const profiles: ReadonlyArray<{
  platform: string;
  handle: string;
  url: string;
  kind: string;
}> = [];
