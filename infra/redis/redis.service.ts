import { Injectable, OnModuleInit, OnApplicationShutdown, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;
  private connectionStatus: 'connected' | 'disconnected' | 'reconnecting' = 'disconnected';

  constructor(private readonly configService: ConfigService) {
    const redisUrl =
      this.configService.get<string>('REDIS_URL') ||
      this.configService.get<string>('redis.url') ||
      process.env.REDIS_URL;

    let host = this.configService.get<string>('REDIS_HOST');
    let port = this.configService.get<number>('REDIS_PORT');
    let password = this.configService.get<string>('REDIS_PASSWORD');

    if (redisUrl) {
      try {
        const parsed = new URL(redisUrl);
        host = host || parsed.hostname;
        port = port || (parsed.port ? parseInt(parsed.port, 10) : 6379);
        if (!password && parsed.password) {
          password = parsed.password;
        }
      } catch {}
    }

    host = host || this.configService.get<string>('redis.host', 'localhost');
    port = port || this.configService.get<number>('redis.port', 6379);
    password = password || this.configService.get<string>('redis.password');

    this.client = redisUrl
      ? new Redis(redisUrl, {
          maxRetriesPerRequest: null,
          lazyConnect: true,
          retryStrategy: (times) => {
            this.logger.warn(`Redis reconnecting... Attempt ${times}`);
            this.connectionStatus = 'reconnecting';
            return Math.min(times * 100, 10000);
          },
        })
      : new Redis({
          host,
          port,
          password: password || undefined,
          maxRetriesPerRequest: null,
          lazyConnect: true,
          retryStrategy: (times) => {
            this.logger.warn(`Redis reconnecting... Attempt ${times}`);
            this.connectionStatus = 'reconnecting';
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
      if (this.client.status === 'wait') {
        await this.client.connect();
      }
      if (this.client.status === 'ready') {
        this.connectionStatus = 'connected';
      }
    } catch (err: any) {
      this.connectionStatus = 'disconnected';
      if (isWorker) {
        this.logger.error(`Redis unavailable during worker startup. Failing fast and exiting. Error: ${err.message}`);
        process.exit(1);
      } else {
        this.logger.warn(`Redis unavailable. Running without cache and Redis-backed features. Error: ${err.message}`);
      }
    }
  }

  isAvailable(): boolean {
    return this.client.status === 'ready';
  }

  getClient(): Redis {
    return this.client;
  }

  async onApplicationShutdown() {
    await this.client.quit();
  }
}
