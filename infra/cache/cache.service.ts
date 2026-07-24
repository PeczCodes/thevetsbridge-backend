import { Injectable, Logger, Optional } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { DistributedLockService } from './distributed-lock.service';
import { CacheKeys } from './cache-keys';
import { MonitoringService } from '../../src/monitoring/monitoring.service';
import {
  CACHE_HITS_TOTAL,
  CACHE_MISSES_TOTAL,
  CACHE_WRITES_TOTAL,
  CACHE_INVALIDATIONS_TOTAL,
  REDIS_CONNECTION_FAILURES_TOTAL,
} from '../../src/monitoring/metrics/cache.metrics';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly distributedLockService: DistributedLockService,
    @Optional() private readonly monitoringService?: MonitoringService,
  ) {}
  
  async getOrSet<T>(key: string, factory: () => Promise<T>, ttlSeconds: number): Promise<T> {
    if (!this.redisService.isAvailable()) {
      this.logger.warn(`Redis unavailable. Bypassing cache for key "${key}" and falling back to database.`);
      return factory();
    }

    // 1. Attempt normal cache lookup.
    try {
      const cached = await this.redisService.getClient().get(key);
      if (cached !== null) {
        return JSON.parse(cached) as T;
      }
    } catch (error) {
      this.logger.warn(`Failed to read from cache for key "${key}":`, error);
    }

    // 2. Cache miss: acquire distributed lock to protect database
    const lockKey = `lock:cache:${key}`;
    const ttlMs = 10000; // 10 seconds lock lifetime to regenerate entry safely

    try {
      return await this.distributedLockService.using(lockKey, ttlMs, async () => {
        // Double-check: Another instance might have populated Redis while this process waited
        try {
          const cachedDoubleCheck = await this.redisService.getClient().get(key);
          if (cachedDoubleCheck !== null) {
            this.logger.log(`[Cache Stampede] Cache populated by another node for key "${key}". Reusing value.`);
            return JSON.parse(cachedDoubleCheck) as T;
          }
        } catch (error) {
          this.logger.warn(`[Cache Stampede] Double-check read failed for key "${key}":`, error);
        }

        // Lock holder executes factory
        this.logger.log(`[Cache Stampede] Lock acquired. Executing regeneration factory for key "${key}".`);
        const result = await factory();

        // Save to cache with Jitter
        const maxJitter = Math.min(ttlSeconds * 0.1, 5);
        const jitter = Math.floor((Math.random() - 0.5) * maxJitter * 2);
        const finalTtl = Math.max(1, ttlSeconds + jitter);

        try {
          await this.redisService.getClient().set(key, JSON.stringify(result), 'EX', finalTtl);
        } catch (setErr) {
          this.logger.warn(`Failed to write to cache for key "${key}":`, setErr);
        }

        return result;
      });
    } catch (err: any) {
      // 3. Lock acquisition failed (contention / timeout)
      // Retry cache lookup a few times with short delay (backoff) to wait for owner to populate cache
      this.logger.warn(`[Cache Stampede] Failed to acquire lock for key "${key}". Retrying cache lookup...`);
      
      const retryAttempts = 5;
      const retryDelayMs = 100;

      for (let attempt = 1; attempt <= retryAttempts; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        
        try {
          if (this.redisService.isAvailable()) {
            const retryCached = await this.redisService.getClient().get(key);
            if (retryCached !== null) {
              this.logger.log(`[Cache Stampede] Cache found on retry attempt ${attempt} for key "${key}".`);
              return JSON.parse(retryCached) as T;
            }
          }
        } catch (retryReadErr) {
          this.logger.warn(`Failed to read from cache during retry for key "${key}":`, retryReadErr);
        }
      }

      // 4. Fallback to direct execution if cache is still not populated
      this.logger.warn(`[Cache Stampede] Cache still missing for key "${key}" after retries. Falling back to database directly.`);
      return factory();
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.redisService.isAvailable()) {
      return null;
    }
    try {
      const val = await this.redisService.getClient().get(key);
      const ns = key.split(':')[0] || 'default';
      if (val !== null) {
        this.monitoringService?.incrementCounter(CACHE_HITS_TOTAL, 1, { namespace: ns });
      } else {
        this.monitoringService?.incrementCounter(CACHE_MISSES_TOTAL, 1, { namespace: ns });
      }
      return val;
    } catch (error) {
      this.monitoringService?.incrementCounter(REDIS_CONNECTION_FAILURES_TOTAL, 1, { event: 'get_error' });
      this.logger.warn(`Failed to read from cache for key "${key}":`, error);
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.redisService.isAvailable()) {
      return;
    }
    try {
      if (ttlSeconds) {
        await this.redisService.getClient().set(key, value, 'EX', ttlSeconds);
      } else {
        await this.redisService.getClient().set(key, value);
      }
      this.monitoringService?.incrementCounter(CACHE_WRITES_TOTAL, 1, { operation: 'set' });
    } catch (error) {
      this.monitoringService?.incrementCounter(REDIS_CONNECTION_FAILURES_TOTAL, 1, { event: 'set_error' });
      this.logger.warn(`Failed to write to cache for key "${key}":`, error);
    }
  }

  async del(key: string): Promise<void> {
    if (!this.redisService.isAvailable()) {
      return;
    }
    try {
      await this.redisService.getClient().del(key);
      const ns = key.split(':')[0] || 'default';
      this.monitoringService?.incrementCounter(CACHE_INVALIDATIONS_TOTAL, 1, { namespace: ns });
      this.logger.log(`[Cache Invalidation] Deleted cache key: "${key}"`);
    } catch (error) {
      this.monitoringService?.incrementCounter(REDIS_CONNECTION_FAILURES_TOTAL, 1, { event: 'del_error' });
      this.logger.warn(`Failed to delete cache for key "${key}":`, error);
    }
  }

  async invalidateUser(userId: string): Promise<void> {
    await this.del(CacheKeys.authMe(userId));
    await this.del(CacheKeys.user(userId));
    await this.del(CacheKeys.userProfile(userId));
  }

  async invalidateVet(userId: string, vetId: string): Promise<void> {
    await this.del(CacheKeys.authMe(userId));
    await this.del(CacheKeys.vet(vetId));
  }

  async invalidateVendor(userId: string, vendorId: string): Promise<void> {
    await this.del(CacheKeys.authMe(userId));
    await this.del(CacheKeys.vendor(vendorId));
  }

  async invalidateWallet(userId: string): Promise<void> {
    await this.del(CacheKeys.authMe(userId));
    await this.del(CacheKeys.wallet(userId));
  }

  // ── Marketplace ────────────────────────────────────────────────────────────

  /** Evict the full listings catalog cache. */
  async invalidateListings(): Promise<void> {
    await this.del(CacheKeys.listings());
    await this.invalidateSearch();
  }

  // ── Vet Directory ─────────────────────────────────────────────────────────

  /**
   * Evict every cached vet directory listing (all filter variants).
   * Uses SCAN so it is non-blocking and safe in production Redis.
   */
  async invalidateVetsList(): Promise<void> {
    await this.scanAndDel('vets:list:*');
    await this.invalidateSearch();
  }

  // ── Search ──────────────────────────────────────────────────────────────────

  /** Evict the search queries and search recent results cache. */
  async invalidateSearch(): Promise<void> {
    await this.del(CacheKeys.searchRecent());
    await this.scanAndDel('search:query:*');
  }

  /**
   * Scan Redis for keys matching `pattern` and delete them in batches.
   * Uses SCAN instead of KEYS to avoid blocking the Redis event loop.
   */
  private async scanAndDel(pattern: string): Promise<void> {
    if (!this.redisService.isAvailable()) return;
    const client = this.redisService.getClient();
    let cursor = '0';
    let deleted = 0;

    try {
      do {
        const [nextCursor, keys] = await client.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100,
        );
        cursor = nextCursor;

        if (keys.length > 0) {
          await client.del(...keys);
          deleted += keys.length;
          this.logger.log(
            `[Cache Invalidation] scanAndDel: deleted ${keys.length} key(s) matching "${pattern}"`,
          );
        }
      } while (cursor !== '0');

      this.logger.log(
        `[Cache Invalidation] scanAndDel complete. Total deleted: ${deleted} key(s) matching "${pattern}"`,
      );
    } catch (error) {
      this.logger.warn(
        `[Cache Invalidation] scanAndDel failed for pattern "${pattern}":`,
        error,
      );
    }
  }
}
