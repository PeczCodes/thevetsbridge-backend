import { Injectable, Logger } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { RedisService } from './redis.service';

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  constructor(private readonly redisService: RedisService) {}

  async increment(
    key: string,
    ttl: number, // in milliseconds
    limit: number,
    blockDuration: number, // in milliseconds
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const ttlSeconds = Math.max(1, Math.ceil(ttl / 1000));
    const blockSeconds = blockDuration > 0 ? Math.ceil(blockDuration / 1000) : 0;

    if (!this.redisService.isAvailable()) {
      this.logger.warn('Redis storage is unavailable. Throttler failing open.');
      return {
        totalHits: 1,
        timeToExpire: ttlSeconds,
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }

    const countKey = `throttler:${key}:${throttlerName}:count`;
    const blockKey = `throttler:${key}:${throttlerName}:blocked`;

    // Lua script to atomically increment, check block state, and manage TTLs
    const luaScript = `
      -- 1. Check if client is already blocked
      local isBlocked = redis.call('exists', KEYS[2])
      if isBlocked == 1 then
        local blockTtl = redis.call('ttl', KEYS[2])
        if blockTtl < 0 then blockTtl = 0 end
        local count = redis.call('get', KEYS[1]) or 0
        return {tonumber(count), 0, 1, blockTtl}
      end

      -- 2. Increment hit count
      local hits = redis.call('incr', KEYS[1])
      if hits == 1 then
        redis.call('expire', KEYS[1], ARGV[1])
      end

      -- 3. Defensive TTL check to avoid immortal keys if Redis dropped expire
      local keyTtl = redis.call('ttl', KEYS[1])
      if keyTtl <= 0 then
        redis.call('expire', KEYS[1], ARGV[1])
        keyTtl = tonumber(ARGV[1])
      end

      -- 4. Check if limit is exceeded
      if hits > tonumber(ARGV[2]) then
        local configuredBlock = tonumber(ARGV[3])
        local effectiveBlock = (configuredBlock > 0) and configuredBlock or keyTtl
        if effectiveBlock <= 0 then
          effectiveBlock = tonumber(ARGV[1])
        end

        redis.call('set', KEYS[2], '1', 'EX', effectiveBlock)
        return {hits, keyTtl, 1, effectiveBlock}
      end

      return {hits, keyTtl, 0, 0}
    `;

    try {
      const result = (await this.redisService.getClient().eval(
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
