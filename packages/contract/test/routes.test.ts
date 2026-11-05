import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { API } from "../src/paths.ts";
import { ACCOUNT_ROUTES, HTTP_ROUTES, routePath } from "../src/routes.ts";
import { TOOLS } from "../src/tools.ts";

describe("HTTP routes", () => {
  it("cover every tool but the planning guide", () => {
    assert.deepEqual(
      Object.keys(HTTP_ROUTES).sort(),
      TOOLS.map((tool) => tool.name)
        .filter((name) => name !== "get_planning_guide")
        .sort(),
    );
  });

  it("name only fields of the tool's input", () => {
    for (const [name, route] of Object.entries(HTTP_ROUTES)) {
      const shape = (TOOLS.find((tool) => tool.name === name)?.input as unknown as { shape: object }).shape;
      for (const field of [...route.pathFields, ...route.queryFields]) {
        assert.ok(field in shape, `${name}: ${field}`);
      }
    }
  });

  it("build the same paths as API", () => {
    const id = "a/b c";
    const p = (tool: keyof typeof HTTP_ROUTES, input: Record<string, unknown>) =>
      routePath(HTTP_ROUTES[tool], input);
    assert.equal(p("search_hotels", {}), API.hotelSearch);
    assert.equal(p("get_hotel_offers", {}), API.hotelOffers);
    assert.equal(p("book_hotel", {}), API.orders);
    assert.equal(p("get_hotel", { hotelId: id }), API.hotel(id));
    assert.equal(
      p("get_hotel", { hotelId: id, include: "rooms", locale: "zh" }),
      API.hotel(id, { rooms: true, locale: "zh" }),
    );
    assert.match(p("get_hotel", { hotelId: "h1", include: "rooms" }), /\?include=rooms$/);
    assert.equal(p("get_order", { orderId: id }), API.order(id));
    assert.equal(p("get_order", { orderId: id, locale: "en" }), API.order(id, { locale: "en" }));
    assert.equal(p("cancel_order", { orderId: id }), API.orderCancel(id));
    assert.equal(p("pay_order", { orderId: id }), API.orderPay(id));
    assert.equal(p("list_orders", {}), API.orders);
    assert.equal(
      p("list_orders", { locale: "en", limit: 5, cursor: "c" }),
      `${API.orders}?cursor=c&limit=5&locale=en`,
    );
    assert.equal(routePath(ACCOUNT_ROUTES.me, {}), API.me);
    assert.equal(routePath(ACCOUNT_ROUTES.authConfig, {}), API.authConfig);
  });
});
