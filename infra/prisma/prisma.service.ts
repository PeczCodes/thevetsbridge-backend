import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectQueue('outbox-events')
    private readonly outboxQueue: Queue,
  ) {
    super({
      log: ['error', 'warn'],
    });
  }

  async onModuleInit() {
    this.logger.log('Connecting to database...');
    try {
      await this.$connect();
      this.logger.log('PostgreSQL connected.');
    } catch (err: any) {
      this.logger.error(`PostgreSQL connection failed: ${err.message || err}`);
      throw err;
    }

    const bypass = this.configService.get<boolean>('app.bypassOutbox') ?? false;
    if (bypass) {
      this.logger.log('Transactional Outbox bypass is active. Registering Prisma middleware interceptor.');
      this.$use(async (params, next) => {
        if (params.model === 'OutboxEvent' && params.action === 'create') {
          const { type, payload } = params.args.data;
          this.logger.log(`[Outbox Bypass] Intercepted database write of type: ${type}. Routing directly to BullMQ.`);
          const fakeId = `fake_outbox_${Math.random().toString(36).substring(2, 11)}`;
          try {
            await this.outboxQueue.add(
              'process-event',
              {
                eventId: fakeId,
                type,
                payload,
              },
              {
                jobId: fakeId,
                attempts: 5,
                backoff: {
                  type: 'exponential',
                  delay: 2000,
                },
              },
            );
          } catch (err) {
            this.logger.error(`[Outbox Bypass] Failed to direct-publish to outbox-events queue: ${err}`);
            throw err;
          }
          return {
            id: fakeId,
            type,
            payload,
            published: true,
            createdAt: new Date(),
            publishedAt: new Date(),
          };
        }
        return next(params);
      });
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
