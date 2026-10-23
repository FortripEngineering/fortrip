import type { Hotel } from "../outputs/hotel.ts";
import { money, named, roomFacts } from "./format.ts";

/* `get_hotel` (spec §8): the full description and every policy (C8). */

type Times = Hotel["checkInTimes"];
type RoomType = NonNullable<Hotel["rooms"]>["items"][number];

function times(what: string, t: Times): string {
  if (t.from === null && t.until === null) return `${what}: not listed`;
  return `${what} from ${t.from ?? "not listed"}, until ${t.until ?? "not listed"}`;
}

function deposit(d: Hotel["deposit"]): string {
  if (d.required === null) return "Deposit: not stated";
  if (!d.required) return "Deposit: not required";
  return `Deposit: required, ${d.amount ? money(d.amount) : "amount not stated"}`;
}

function roomLine(r: RoomType): string {
  return [`- ${r.name.text}`, ...roomFacts(r)].join(" · ");
}

export function renderHotel(h: Hotel): string {
  const region = h.address.region;
  const lines = [
    [
      named(h.name, h.names),
      h.stars === null ? "stars not listed" : `${h.stars}★`,
      h.hotelId,
      h.bookable ? "" : "no longer bookable (it has left the catalogue)",
    ]
      .filter(Boolean)
      .join(" · "),
    [
      `Address: ${h.address.line ? h.address.line.text : "not listed"}`,
      region ? `${region.name} ${region.placeId}` : "",
      h.address.countryCode ?? "",
      h.location ? `${h.location.lat}, ${h.location.lng}` : "location not listed",
      `time zone ${h.timeZone ?? "not listed"}`,
    ]
      .filter(Boolean)
      .join(" · "),
    `${times("Check-in", h.checkInTimes)} · ${times("Check-out", h.checkOutTimes)} (local time)`,
    `Breakfast served: ${h.breakfastServed === null ? "not stated" : h.breakfastServed ? "yes" : "no"}`,
    deposit(h.deposit),
    `Phone: ${h.contact.phone ?? "not listed"} · Website: ${h.contact.website ?? "not listed"}`,
  ];

  if (!h.amenities.listed) {
    lines.push('Amenities: not listed (unknown, not "none")');
  } else if (h.amenities.items.length === 0) {
    lines.push("Amenities: none listed");
  } else {
    const items = h.amenities.items.map((a) => `${a.name.text} (${a.code})`);
    lines.push(`Amenities listed (others may exist): ${items.join(", ")}`);
  }

  if (!h.policies.listed) {
    lines.push("Policies: not listed");
  } else if (h.policies.items.length === 0) {
    lines.push("Policies: none listed");
  } else {
    lines.push("Policies:", ...h.policies.items.map((p) => `- ${p.topic}: ${p.text}`));
  }

  if (h.rooms) {
    if (!h.rooms.listed) lines.push("Rooms: not listed");
    else if (h.rooms.items.length === 0) lines.push("Rooms: none listed");
    else lines.push("Rooms:", ...h.rooms.items.map(roomLine));
  }

  if (h.description === null) {
    lines.push("Description: not listed");
  } else {
    lines.push(`Description (${h.description.locale}):`, h.description.text);
  }
  return lines.join("\n");
}
