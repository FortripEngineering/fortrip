/** Where the agent API lives. Paths only: the origin is the caller's to choose. */
export const API = {
  me: "/api/agent/v1/me",
  authConfig: "/api/agent/v1/auth/config",
  search: "/api/agent/v1/hotels/search",
  rates: "/api/agent/v1/hotels/rates",
  bookings: "/api/agent/v1/hotels/bookings",
  mcp: "/api/mcp",
  hotel(id: number, includeRooms?: boolean): string {
    return `/api/agent/v1/hotels/${id}${includeRooms ? "?include=rooms" : ""}`;
  },
} as const;
