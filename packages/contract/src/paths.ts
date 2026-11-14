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
  hotel(id: string, opts?: { roomTypes?: boolean; locale?: "en" | "zh" }): string {
    const query: string[] = [];
    if (opts?.roomTypes) query.push("include=roomTypes");
    if (opts?.locale) query.push(`locale=${opts.locale}`);
    return `/v1/hotels/${encodeURIComponent(id)}${query.length ? `?${query.join("&")}` : ""}`;
  },
  order(id: string, opts?: { locale?: "en" | "zh" }): string {
    return `/v1/orders/${encodeURIComponent(id)}${opts?.locale ? `?locale=${opts.locale}` : ""}`;
  },
  orderCancel(id: string): string {
    return `/v1/orders/${encodeURIComponent(id)}/cancel`;
  },
  orderPay(id: string): string {
    return `/v1/orders/${encodeURIComponent(id)}/pay`;
  },
} as const;

/** The MCP server answers at the root of `PUBLIC_ORIGINS.mcp`. */
export const MCP_PATH = "/";

/** The URL to add as a remote MCP server. */
export const MCP_SERVER_URL = `${PUBLIC_ORIGINS.mcp}${MCP_PATH}`;

/** Installs the CLI skill into an agent. */
export const SKILL_INSTALL_COMMAND =
  "npx skills add FortripEngineering/fortrip --skill fortrip-cli";

export const REPOSITORY_URL = "https://github.com/FortripEngineering/fortrip";

export const DOCS_ORIGIN = "https://docs.fortrip.ai";
