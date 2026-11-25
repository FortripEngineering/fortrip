/** The site's name and one-line summary: its title, `llms.txt` and Open Graph. */
export const SITE = {
  name: "Fortrip Docs",
  description: "Connect an AI agent to Fortrip to search, price and book hotels.",
};

/** Fortrip's policies on its website, linked from every page's footer and the FAQ. */
export const POLICIES = {
  terms: "https://fortrip.ai/terms",
  privacy: "https://fortrip.ai/privacy",
  bookingConditions: "https://fortrip.ai/booking-conditions",
} as const;

/** The footer on every page, in order. */
export const FOOTER_LINKS = [
  { key: "terms", text: "Terms", url: POLICIES.terms },
  { key: "privacy", text: "Privacy", url: POLICIES.privacy },
  { key: "bookingConditions", text: "Booking conditions", url: POLICIES.bookingConditions },
  { key: "support", text: "Support", url: "/faq#support" },
] as const;
