import { Module, Global } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { OutboxModule } from './outbox/outbox.module';
import { APP_FILTER, APP_PIPE, APP_INTERCEPTOR, APP_GUARD } from '@nestjs/core';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { ValidationPipe } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from './redis/redis.module';
import { CacheModule } from './cache/cache.module';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppThrottlerGuard } from './throttler/app-throttler.guard';
import { RedisThrottlerStorage } from './redis/redis-throttler-storage';
import { CloudinaryModule } from '../src/cloudinary/cloudinary.module';
import { NotificationsQueueModule } from './queues/notifications-queue/notifications-queue.module';
import { MetricsModule } from '../src/metrics/metrics.module';
import { CircuitBreakerModule } from './circuit-breaker/circuit-breaker.module';

import { EncryptionService } from './security/encryption.service';
import { RedisService } from './redis/redis.service';
import { DEFAULT_BULLMQ_OPTIONS } from '../config/bullmq.config';

@Global()
@Module({
  imports: [
    PrismaModule,
    OutboxModule,
    RedisModule,
    CacheModule,
    CloudinaryModule,
    NotificationsQueueModule,
    MetricsModule,
    CircuitBreakerModule,
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [RedisThrottlerStorage, ConfigService],
      useFactory: (
        storage: RedisThrottlerStorage,
        configService: ConfigService,
      ) => [
        {
          ttl: configService.getOrThrow('throttler.ttl'), // 60 seconds
          limit: configService.getOrThrow('throttler.limit'), // limit to 100 requests per window
          storage
        },
      ],
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisUrl =
          configService.get<string>('redis.url') ||
          configService.get<string>('REDIS_URL');
        return {
          ...DEFAULT_BULLMQ_OPTIONS,
          connection: redisUrl
            ? {
                url: redisUrl,
                maxRetriesPerRequest: null,
              }
            : {
                host:
                  configService.get<string>('redis.host') ||
                  configService.get<string>('REDIS_HOST', 'localhost'),
                port:
                  configService.get<number>('redis.port') ||
                  configService.get<number>('REDIS_PORT', 6379),
                password:
                  configService.get<string>('redis.password') ||
                  configService.get<string>('REDIS_PASSWORD') ||
                  undefined,
                maxRetriesPerRequest: null,
              },
        };
      },
    }),
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
    IdempotencyInterceptor,
    {
      provide: APP_GUARD,
      useClass: AppThrottlerGuard,
    },
    EncryptionService,
  ],
  exports: [
    IdempotencyInterceptor,
    CircuitBreakerModule,
    CloudinaryModule,
    EncryptionService,
    RedisModule,
  ],
})
export class InfraModule {}
