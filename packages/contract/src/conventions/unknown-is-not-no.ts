/*
 * Spec §6, "Unknown is not no": every array or boolean in a response is
 * nullable or has a sibling flag (`known`, `listed`, `disclosure`, `status`)
 * saying whether the source stated it. These fields are exempt because they
 * are always fully known. A key names a field by its property path, matched
 * whole or as a dotted suffix (`localities.items` covers
 * `coverage.localities.items`).
 */

const RESULT_LIST = "A result list: the API built it, so an empty list means none, not unknown";
const REQUEST_ECHO = "An echo of the request: it says what the caller sent";
const API_DECIDES = "A flag the API itself decides, so it is never unknown";
const THE_FLAG = "The flag that says whether the source stated its siblings";

export const UNKNOWN_IS_NOT_NO_EXEMPTIONS: Readonly<Record<string, string>> = {
  data: `${RESULT_LIST} (a page of hotels or orders).`,
  notes: `${RESULT_LIST} (the notes the search added).`,
  offers: `${RESULT_LIST} (the offers left after selection).`,
  items: `${RESULT_LIST} (an order's items, a listed set's entries).`,
  issues: `${RESULT_LIST} (what was wrong with the request).`,
  changes: `${RESULT_LIST} (every change between the offer and the verify).`,
  hotels: `${RESULT_LIST} (the hotels that have offers).`,
  unavailable: `${RESULT_LIST} (the hotels without offers, each with a reason).`,
  candidates: `${RESULT_LIST} (the places a name could mean).`,
  "localities.items": `${RESULT_LIST} (the top locality hubs of the scope).`,
  "localities.items.includes": `${RESULT_LIST} (other places among a hub's members).`,
  filterable: `${RESULT_LIST} (the amenity codes a search can filter by).`,
  rooms: `${REQUEST_ECHO} (the rooms of the stay).`,
  childrenAges: `${REQUEST_ECHO} (each child's age; empty means no children).`,
  retryable: `${API_DECIDES} (whether retrying can help).`,
  mandatory: `${API_DECIDES} (whether a fee is charged whatever the guest chooses).`,
  worse: `${API_DECIDES} (whether a change is worse for the guest).`,
  requiresSignIn: `${API_DECIDES} (whether the payment link needs a website sign-in).`,
  localCurrencyAtCheckout: `${API_DECIDES} (whether checkout may charge in the card's currency).`,
  bookable: `${API_DECIDES} (whether the hotel is still in the index).`,
  cityLike: `${API_DECIDES} (frozen per gazetteer release; null where not computed).`,
  known: `${THE_FLAG} (meals).`,
  listed: `${THE_FLAG} (policies, amenities, rooms).`,
};
