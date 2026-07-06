import { Module, Global } from '@nestjs/common';
import { CacheService } from './cache.service';
import { RedisModule } from '../redis/redis.module';
import { DistributedLockService } from './distributed-lock.service';

@Global()
@Module({
  imports: [RedisModule],
  providers: [CacheService, DistributedLockService],
  exports: [CacheService, DistributedLockService],
})
export class CacheModule {}
