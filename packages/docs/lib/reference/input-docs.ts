import { TOOLS, type ToolName } from "@fortrip/agent-contract";
import type { z } from "zod";

/** The tools that take arguments. */
type InputToolName = Exclude<ToolName, "get_planning_guide">;

function inputOf(name: InputToolName): z.ZodType {
  const schema = TOOLS.find((tool) => tool.name === name)?.input;
  if (!schema) throw new Error(`${name} has no input schema in the contract`);
  return schema;
}

/** Input schemas the docs render; each field's text is its `.describe()`,
 *  and `schema-rows.test.ts` fails when the contract gains a field without
 *  one. */
export const TOOL_INPUTS: Record<InputToolName, z.ZodType> = {
  search_hotels: inputOf("search_hotels"),
  get_hotel: inputOf("get_hotel"),
  get_hotel_offers: inputOf("get_hotel_offers"),
  book_hotel: inputOf("book_hotel"),
  get_order: inputOf("get_order"),
  list_orders: inputOf("list_orders"),
  cancel_order: inputOf("cancel_order"),
  pay_order: inputOf("pay_order"),
};
