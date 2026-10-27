/** The public hosts of the v1 API and its MCP server. */
export const PUBLIC_ORIGINS = {
  api: "https://api.fortrip.ai",
  mcp: "https://mcp.fortrip.ai",
} as const;

/** Where v1 lives on `PUBLIC_ORIGINS.api`. */
export const API = {
  me: "/v1/me",
  authConfig: "/v1/auth/config",
  hotelSearch: "/v1/hotels/search",
  hotelOffers: "/v1/hotels/offers",
  orders: "/v1/orders",
  hotel(id: string, opts?: { rooms?: boolean; locale?: "en" | "zh" }): string {
    const query: string[] = [];
    if (opts?.rooms) query.push("include=rooms");
    if (opts?.locale) query.push(`locale=${opts.locale}`);
    return `/v1/hotels/${encodeURIComponent(id)}${query.length ? `?${query.join("&")}` : ""}`;
  },
  order(id: string, opts?: { locale?: "en" | "zh" }): string {
    return `/v1/orders/${encodeURIComponent(id)}${opts?.locale ? `?locale=${opts.locale}` : ""}`;
  },
  orderCancel(id: string): string {
    return `/v1/orders/${encodeURIComponent(id)}/cancel`;
  },
} as const;

/** The MCP server answers at the root of `PUBLIC_ORIGINS.mcp`. */
export const MCP_PATH = "/";
