import { Injectable, Inject, Logger } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import Redis from 'ioredis';

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  
  
  async increment(
    key: string,
    ttl: number, // in milliseconds
    limit: number,
    blockDuration: number, // in milliseconds
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const ttlSeconds = Math.ceil(ttl / 1000);
    const blockSeconds = Math.ceil(blockDuration / 1000);
    
    
    
    const countKey = `throttler:${key}:${throttlerName}:count`;
    const blockKey = `throttler:${key}:${throttlerName}:blocked`;

    // Lua script to atomically increment, check block state, and manage TTLs
    const luaScript = `
      local isBlocked = redis.call('exists', KEYS[2])
      if isBlocked == 1 then
        local blockTtl = redis.call('ttl', KEYS[2])
        local count = redis.call('get', KEYS[1]) or 0
        return {tonumber(count), 0, 1, blockTtl}
      end

      local hits = redis.call('incr', KEYS[1])
      if hits == 1 then
        redis.call('expire', KEYS[1], ARGV[1])
      end

      local keyTtl = redis.call('ttl', KEYS[1])

      if hits > tonumber(ARGV[2]) then
        redis.call('set', KEYS[2], '1', 'EX', ARGV[3])
        return {hits, keyTtl, 1, tonumber(ARGV[3])}
      end

      return {hits, keyTtl, 0, 0}
    `;

    try {
      const result = (await this.redis.eval(
        luaScript,
        2,
        countKey,
        blockKey,
        ttlSeconds,
        limit,
        blockSeconds,
      )) as [number, number, number, number];

      const [totalHits, timeToExpire, isBlockedVal, timeToBlockExpire] = result;

      return {
        totalHits,
        timeToExpire,
        isBlocked: isBlockedVal === 1,
        timeToBlockExpire,
      };
    } catch (error: any) {
      this.logger.warn(`Redis throttler storage error: ${error.message}. Falling back to open failsafe.`);
      return {
        totalHits: 1,
        timeToExpire: ttlSeconds,
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }
}
