/**
 * Best-effort city photo from Wikipedia's REST summary endpoint.
 *
 * Always queried against the French Wikipedia (the city names we hold are
 * French and fr.wikipedia covers French + most European cities, following
 * redirects), since a photo is language-agnostic. Results — including misses —
 * are cached as promises so repeat/concurrent lookups dedupe. Network or parse
 * failures resolve to null; callers hide the image when null.
 */
const cache = new Map<string, Promise<string | null>>();

async function load(city: string): Promise<string | null> {
  const title = encodeURIComponent(city.trim().replace(/ /g, "_"));
  const url = `https://fr.wikipedia.org/api/rest_v1/page/summary/${title}`;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const data = (await res.json()) as { thumbnail?: { source?: string } };
    return data.thumbnail?.source ?? null;
  } catch {
    return null;
  }
}

export function cityPhoto(city: string): Promise<string | null> {
  const key = city.toLowerCase();
  let p = cache.get(key);
  if (!p) {
    p = load(city);
    cache.set(key, p);
  }
  return p;
}
