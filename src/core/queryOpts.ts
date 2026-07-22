// Pure derivations of the search options from a SearchQuery, shared by the render
// (src/app.ts) and the background-warming worker (src/search/warm.ts). Sharing them
// guarantees both sides produce IDENTICAL connection-cache keys, so the work the
// worker does off-thread is exactly what the render then reads back as a cache hit.

import type { SearchQuery, Journey } from "../types";
import type { FilterOptions } from "./search";
import type { ConnectionOptions } from "./connections";
import type { GetawayOptions } from "./getaways";
import { HUB_STATIONS, OVERNIGHT_MAX_CONNECTION_MIN } from "../config";
import { stayNights } from "./roundtrip";

/** Filter options (time window, night rules, duration cap) for a query. */
export function filterOptsFor(q: SearchQuery): FilterOptions {
  return {
    departAfter: q.departAfter,
    departBefore: q.departBefore,
    arriveBefore: q.arriveBefore,
    maxDurationMin: q.maxDurationMin,
    trainType: q.trainType,
    ...(q.excludeNight ? { excludeNight: true } : {}),
    ...(q.onlyNight ? { onlyNight: true } : {}),
    // Overnight stopovers widen the layover ceiling so a journey can wait overnight
    // at a hub instead of being capped to a ~4h connection.
    ...(q.overnight ? { maxConnectionMin: OVERNIGHT_MAX_CONNECTION_MIN } : {}),
  };
}

/** via-aware connection options for an exact route, shared by both legs of a round
 *  trip so a green day / kept journey honours the same hub + connection budget. */
export function odConnOptsFor(
  q: SearchQuery,
  origin: string,
  destination: string,
): { connOpts: ConnectionOptions; passesVia: (j: Journey) => boolean } {
  const viaId = q.via && q.via !== origin && q.via !== destination ? q.via : undefined;
  const connOpts: ConnectionOptions = {
    ...filterOptsFor(q),
    maxConnections: viaId ? Math.max(1, q.maxConnections) : q.maxConnections,
    ...(viaId ? { hubs: [...HUB_STATIONS, viaId] } : {}),
  };
  return { connOpts, passesVia: (j) => !viaId || j.hubs.includes(viaId) };
}

/** Connection options for the getaway / round-trip-discovery searches, keyed off the
 *  "How long?" stay choice: same-day is nights 0, a fixed N-night stay pins that many
 *  nights, and Flexible keeps the longest feasible stay up to 3 nights. */
export function getawayOptsFor(q: SearchQuery): GetawayOptions {
  return {
    maxConnections: q.maxConnections,
    ...filterOptsFor(q),
    ...stayGetawayOpts(q.stay),
  };
}

/** The nights / flexibility part of the getaway options for a stay choice. */
function stayGetawayOpts(stay: SearchQuery["stay"]): { nights?: number; flexibleNights?: boolean } {
  if (!stay) return {};
  const nights = stayNights(stay);
  // Flexible (null) keeps the longest feasible stay up to 3 nights; a fixed stay pins it.
  return nights == null ? { nights: 3, flexibleNights: true } : { nights };
}
