import { Module, Global } from '@nestjs/common';
import { CacheService } from './cache.service';
import { RedisModule } from '../redis/redis.module';
import { DistributedLockService } from './distributed-lock.service';
import { SingleFlightService } from './single-flight.service';

@Global()
@Module({
  imports: [RedisModule],
  providers: [CacheService, DistributedLockService, SingleFlightService],
  exports: [CacheService, DistributedLockService, SingleFlightService],
})
export class CacheModule {}

