import IORedis from "ioredis";
import type { Env } from "../../config/env.js";

type Entry = { expiresAt: number; value: unknown };

/** Only public/shared catalogue records are accepted by this cache. */
export class CatalogueCache {
  private readonly memory = new Map<string, Entry>();
  private readonly redis: IORedis | null;
  private generation = 1;
  private generationRefreshedAt = 0;
  private readonly counters = {
    memoryHits: 0,
    redisHits: 0,
    misses: 0,
    redisCommands: 0,
    evictions: 0,
  };

  constructor(private readonly env: Env) {
    this.redis = env.REDIS_URL
      ? new IORedis(env.REDIS_URL, {
          lazyConnect: true,
          connectTimeout: 500,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          retryStrategy: () => null,
        })
      : null;
    this.redis?.on("error", () => undefined);
  }

  private async connectRedis() {
    if (this.redis?.status === "wait") await this.redis.connect();
  }

  private generationKey() {
    return `${this.env.REDIS_KEY_PREFIX}:catalogue:generation`;
  }

  private async key(key: string, forceGenerationRefresh = false) {
    const now = Date.now();
    if (
      this.redis &&
      (forceGenerationRefresh ||
        now - this.generationRefreshedAt >=
          this.env.CATALOGUE_GENERATION_CACHE_SECONDS * 1000)
    ) {
      try {
        await this.connectRedis();
        this.counters.redisCommands += 1;
        const existing = await this.redis.get(this.generationKey());
        let sharedGeneration = Number(existing);
        if (!existing) {
          this.counters.redisCommands += 1;
          const initialized = await this.redis.set(this.generationKey(), "1", "NX");
          sharedGeneration = initialized === "OK" ? 1 : 0;
          if (!sharedGeneration) {
            this.counters.redisCommands += 1;
            sharedGeneration = Number(await this.redis.get(this.generationKey()));
          }
        }
        if (Number.isSafeInteger(sharedGeneration) && sharedGeneration > 0) {
          if (sharedGeneration !== this.generation) this.memory.clear();
          this.generation = sharedGeneration;
          this.generationRefreshedAt = now;
        }
      } catch {
        // Retain the process-local generation while Redis is unavailable.
      }
    }
    return `${this.env.REDIS_KEY_PREFIX}:catalogue:v${this.generation}:${key}`;
  }

  async get<T>(key: string): Promise<T | null> {
    // A local hit still verifies the lightweight shared generation so another
    // process cannot serve stale catalogue data after an invalidation.
    const scoped = await this.key(key, Boolean(this.redis && this.memory.size));
    const entry = this.memory.get(scoped);
    if (entry && entry.expiresAt > Date.now()) {
      this.memory.delete(scoped);
      this.memory.set(scoped, entry);
      this.counters.memoryHits += 1;
      return structuredClone(entry.value) as T;
    }
    this.memory.delete(scoped);
    if (this.redis) {
      try {
        await this.connectRedis();
        this.counters.redisCommands += 1;
        const value = await this.redis.get(scoped);
        if (value) {
          const parsed = JSON.parse(value) as T;
          this.putMemory(scoped, parsed);
          this.counters.redisHits += 1;
          return parsed;
        }
      } catch {
        // PostgreSQL remains the source of truth during Redis outages.
      }
    }
    this.counters.misses += 1;
    return null;
  }

  private putMemory(key: string, value: unknown) {
    this.memory.delete(key);
    this.memory.set(key, {
      expiresAt: Date.now() + this.env.CATALOGUE_CACHE_TTL_SECONDS * 1000,
      value: structuredClone(value),
    });
    while (this.memory.size > this.env.CATALOGUE_LOCAL_CACHE_MAX_ENTRIES) {
      const oldest = this.memory.keys().next().value as string | undefined;
      if (!oldest) break;
      this.memory.delete(oldest);
      this.counters.evictions += 1;
    }
  }

  async set(key: string, value: unknown) {
    const scoped = await this.key(key);
    this.putMemory(scoped, value);
    if (this.redis) {
      try {
        await this.connectRedis();
        this.counters.redisCommands += 1;
        await this.redis.set(
          scoped,
          JSON.stringify(value),
          "EX",
          this.env.CATALOGUE_CACHE_TTL_SECONDS,
        );
      } catch {
        // Local bounded cache is the safe fallback.
      }
    }
  }

  async invalidate() {
    this.memory.clear();
    if (this.redis) {
      try {
        await this.connectRedis();
        this.counters.redisCommands += 1;
        const sharedGeneration = Number(await this.redis.incr(this.generationKey()));
        if (Number.isSafeInteger(sharedGeneration) && sharedGeneration > 0) {
          this.generation = sharedGeneration;
          this.generationRefreshedAt = Date.now();
          return;
        }
      } catch {
        // The local generation still prevents stale in-process reads.
      }
    }
    this.generation += 1;
    this.generationRefreshedAt = Date.now();
  }

  stats() {
    return { ...this.counters, entries: this.memory.size, generation: this.generation };
  }

  async close() {
    if (!this.redis) return;
    this.redis.disconnect();
  }
}
