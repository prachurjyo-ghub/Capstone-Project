import { describe, expect, it } from "vitest";
import { loadEnv, type Env } from "../../config/env.js";
import { CatalogueCache } from "./catalogue.cache.js";

describe("CatalogueCache local memory protection", () => {
  it("caps entries, records LRU evictions, and clears on invalidation", async () => {
    const env: Env = {
      ...loadEnv(),
      REDIS_URL: undefined,
      CATALOGUE_LOCAL_CACHE_MAX_ENTRIES: 10,
      CATALOGUE_CACHE_TTL_SECONDS: 120,
    };
    const cache = new CatalogueCache(env);

    for (let index = 0; index < 25; index += 1) {
      await cache.set(`product:${index}`, { index });
    }

    expect(cache.stats()).toMatchObject({ entries: 10, evictions: 15 });
    expect(await cache.get("product:24")).toEqual({ index: 24 });
    expect(cache.stats().memoryHits).toBe(1);
    await cache.invalidate();
    expect(cache.stats().entries).toBe(0);
    await cache.close();
  });
});
