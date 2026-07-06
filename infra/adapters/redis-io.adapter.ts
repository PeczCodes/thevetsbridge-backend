import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { INestApplicationContext, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor: ReturnType<typeof createAdapter>;

  constructor(private appOrLocate: INestApplicationContext) {
    super(appOrLocate);
  }

  async connectToRedis(): Promise<void> {
    try {
      const redisService = this.appOrLocate.get(RedisService);
      const pubClient = redisService.getClient();

      // Ensure the pub client is connected (if it's in lazy/wait status)
      if (pubClient.status === 'wait') {
        await pubClient.connect();
      }

      const subClient = pubClient.duplicate();
      await subClient.connect();

      // Handle connection errors
      subClient.on('error', (err) => this.logger.error('Redis SubClient Error:', err));
      pubClient.on('error', (err) => this.logger.error('Redis PubClient Error:', err));

      this.adapterConstructor = createAdapter(pubClient, subClient);
    } catch (err: any) {
      this.logger.warn({ err }, `Redis IoAdapter failed to connect to Redis: ${err.message}. WebSocket will run with in-memory adapter.`);
    }
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    } else {
      this.logger.warn('Redis IoAdapter Constructor is not initialized. Falling back to default memory adapter.');
    }
    return server;
  }
}
