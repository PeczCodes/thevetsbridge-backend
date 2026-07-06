import { Injectable, OnModuleInit, OnApplicationShutdown, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;
  private connectionStatus: 'connected' | 'disconnected' | 'reconnecting' = 'disconnected';

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = this.configService.get<number>('REDIS_PORT', 6379);
    const password = this.configService.get<string>('REDIS_PASSWORD');

    this.client = new Redis({
      host,
      port,
      password,
      maxRetriesPerRequest: null,
      lazyConnect: true,
      retryStrategy: (times) => {
        this.logger.warn(`Redis reconnecting... Attempt ${times}`);
        this.connectionStatus = 'reconnecting';
        // Exponential backoff capped at 10 seconds
        return Math.min(times * 100, 10000);
      },
    });

    this.client.on('ready', () => {
      if (this.connectionStatus !== 'connected') {
        if (this.connectionStatus === 'reconnecting') {
          this.logger.log('Redis reconnected.');
        } else {
          this.logger.log('Redis connected.');
        }
        this.connectionStatus = 'connected';
      }
    });

    this.client.on('end', () => {
      if (this.connectionStatus !== 'disconnected') {
        this.connectionStatus = 'disconnected';
      }
    });

    this.client.on('error', (err) => {
      this.logger.error(`Redis connection error: ${err.message}`);
    });
  }

  async onModuleInit() {
    const isWorker = process.env.SERVICE_TYPE === 'worker' || process.env.IS_WORKER === 'true';
    try {
      this.logger.log('Attempting initial Redis connection...');
      await this.client.connect();
      if (this.client.status === 'ready') {
        this.connectionStatus = 'connected';
      }
    } catch (err: any) {
      this.connectionStatus = 'disconnected';
      if (isWorker) {
        this.logger.error(`Redis unavailable during worker startup. Failing fast and exiting. Error: ${err.message}`);
        process.exit(1);
      } else {
        this.logger.warn('Redis unavailable. Running without cache and Redis-backed features.');
      }
    }
  }

  isAvailable(): boolean {
    return this.connectionStatus === 'connected';
  }

  getClient(): Redis {
    return this.client;
  }

  async onApplicationShutdown() {
    await this.client.quit();
  }
}
