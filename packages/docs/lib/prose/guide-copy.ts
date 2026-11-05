import { renderGuide } from "@fortrip/agent-contract";

/** The sentence of the contract's MCP guide that matches `pattern`, so a page
 *  says what the agents are told, word for word. Throws when the guide no
 *  longer has one (the build fails rather than the page drifting). */
function guideSentence(pattern: RegExp): string {
  const sentence = renderGuide("mcp", "main")
    .split(/(?<=[.!?])\s+|\n/)
    .find((candidate) => pattern.test(candidate));
  if (!sentence) throw new Error(`the MCP guide has no sentence ${pattern}`);
  return sentence.trim();
}

/** What the user may see on Stripe's page (Stripe's Adaptive Pricing). */
export const ADAPTIVE_PRICING = guideSentence(/local currency/);
