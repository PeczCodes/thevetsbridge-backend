import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly pendingPromises = new Map<string, Promise<any>>();

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}
  
  async getOrSet<T>(key: string, factory: () => Promise<T>, ttlSeconds: number): Promise<T> {
    try {
      const cached = await this.redis.get(key);
      if (cached !== null) {
        return JSON.parse(cached) as T;
      }
    } catch (error) {
      this.logger.warn(`Failed to read from cache for key "${key}":`, error);
    }

    let pending = this.pendingPromises.get(key);
    if (pending) {
      this.logger.log(`Cache stampede protected for key "${key}". Waiting on existing execution.`);
      return pending;
    }

    const promise = (async () => {
      try {
        const result = await factory();
        
        const maxJitter = Math.min(ttlSeconds * 0.1, 5);
        const jitter = Math.floor((Math.random() - 0.5) * maxJitter * 2);
        const finalTtl = Math.max(1, ttlSeconds + jitter);

        try {
          await this.redis.set(key, JSON.stringify(result), 'EX', finalTtl);
        } catch (setErr) {
          this.logger.warn(`Failed to write to cache for key "${key}":`, setErr);
        }

        return result;
      } finally {
        this.pendingPromises.delete(key);
      }
    })();

    this.pendingPromises.set(key, promise);
    return promise;
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.redis.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.redis.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }
}
