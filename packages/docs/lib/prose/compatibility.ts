/**
 * The pre-release compatibility policy (spec §8.1 item 3, the owner's
 * ruling), stated once, on the changelog, through <PreReleasePolicy />. The
 * API page states it in one line and links there. Markdown links and `code`
 * spans only.
 */
export const PRE_RELEASE_POLICY =
  "Fortrip's agent API is pre-release. Until general availability, breaking changes may happen. A breaking change ships only in a new major version of the contract, [`@fortrip/agent-contract`](https://www.npmjs.com/package/@fortrip/agent-contract), and is announced in this changelog with migration notes. After general availability, v1 will change only additively: new fields, endpoints, enum values and error codes.";
