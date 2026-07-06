import { Module, Global } from '@nestjs/common';
import { RedisService } from './redis.service';
import { RedisThrottlerStorage } from './redis-throttler-storage';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  providers: [
    RedisService,
    {
      provide: REDIS_CLIENT,
      inject: [RedisService],
      useFactory: (redisService: RedisService) => redisService.getClient(),
    },
    RedisThrottlerStorage,
  ],
  exports: [RedisService, REDIS_CLIENT, RedisThrottlerStorage],
})
export class RedisModule {}
