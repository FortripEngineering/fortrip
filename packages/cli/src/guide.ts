import { type GuideTopic, renderGuide } from "@fortrip/agent-contract";

import { VERSION } from "./version.ts";

/** The contract's guide for the CLI. It says `fortrip@latest`; printing it
 *  pins this version, so a release published mid-conversation can't change
 *  the CLI under the agent. */
export function readGuide(topic: GuideTopic): string {
  return renderGuide("cli", topic).replaceAll("fortrip@latest", `fortrip@${VERSION}`);
}
