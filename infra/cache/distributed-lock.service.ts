import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import Redlock, { Lock, Settings } from 'redlock';

@Injectable()
export class DistributedLockService {
  private readonly logger = new Logger(DistributedLockService.name);
  private redlock: Redlock | null = null;

  constructor(private readonly redisService: RedisService) {
    if (this.redisService.isAvailable()) {
      this.initRedlock();
    }
  }

  private initRedlock() {
    try {
      const client = this.redisService.getClient();
      this.redlock = new Redlock([client], {
        driftFactor: 0.01,
        retryCount: 3,
        retryDelay: 200,
        retryJitter: 100,
      });

      this.redlock.on('error', (err) => {
        // Redlock throws/emits error alerts during normal contention (e.g. failing to lock)
        this.logger.debug(`[Distributed Lock] Redlock internal alert: ${err.message}`);
      });
    } catch (err: any) {
      this.logger.error('Failed to initialize Redlock instance:', err);
    }
  }

  private getRedlock(): Redlock | null {
    if (!this.redlock && this.redisService.isAvailable()) {
      this.initRedlock();
    }
    return this.redlock;
  }

  /**
   * Acquire a lock for the specified resource keys and duration (TTL in milliseconds).
   */
  async acquire(lockKey: string, ttlMs: number, settings?: Partial<Settings>): Promise<Lock> {
    const redlockInstance = this.getRedlock();
    if (!redlockInstance) {
      throw new Error('Redis lock backend is not available');
    }
    return redlockInstance.acquire([lockKey], ttlMs, settings);
  }

  /**
   * Safe wrapper that automatically acquires and releases a lock for callback execution.
   * If Redis is unavailable, degrades gracefully by directly invoking the callback.
   */
  async using<T>(lockKey: string, ttlMs: number, callback: () => Promise<T>): Promise<T> {
    const redlockInstance = this.getRedlock();
    if (!redlockInstance) {
      this.logger.warn(`Redis lock backend not available. Bypassing lock for key "${lockKey}".`);
      return callback();
    }

    this.logger.log(`[Distributed Lock] Attempting to acquire lock for "${lockKey}" with TTL ${ttlMs}ms`);
    
    return redlockInstance.using([lockKey], ttlMs, async (signal) => {
      this.logger.log(`[Distributed Lock] Lock acquired for "${lockKey}"`);
      if (signal.aborted) {
        throw signal.error || new Error('Lock acquisition aborted');
      }
      const result = await callback();
      this.logger.log(`[Distributed Lock] Executed callback within lock "${lockKey}"`);
      return result;
    });
  }
}
