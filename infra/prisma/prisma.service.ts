import { Injectable, OnModuleInit, OnModuleDestroy, Logger, Optional } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { MonitoringService } from '../../src/monitoring/monitoring.service';
import {
  DB_QUERY_DURATION_SECONDS,
  DB_QUERY_FAILURES_TOTAL,
} from '../../src/monitoring/metrics/db.metrics';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectQueue('outbox-events')
    private readonly outboxQueue: Queue,
    @Optional() private readonly monitoringService?: MonitoringService,
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

    // Query Metrics Middleware
    this.$use(async (params, next) => {
      const startTime = process.hrtime();
      const model = params.model || 'raw';
      const action = params.action || 'query';

      try {
        const result = await next(params);
        const diff = process.hrtime(startTime);
        const durationInSeconds = diff[0] + diff[1] / 1e9;
        this.monitoringService?.observeHistogram(DB_QUERY_DURATION_SECONDS, durationInSeconds, {
          model,
          action,
        });
        return result;
      } catch (error) {
        this.monitoringService?.incrementCounter(DB_QUERY_FAILURES_TOTAL, 1, {
          model,
          action,
        });
        throw error;
      }
    });

    const bypass = this.configService.get<boolean>('app.bypassOutbox') ?? false;
    if (bypass) {
      this.logger.log('Transactional Outbox bypass is active. Registering Prisma middleware & transaction interceptors.');
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

  override async $transaction(arg1: any, arg2?: any): Promise<any> {
    const bypass = this.configService.get<boolean>('app.bypassOutbox') ?? false;
    if (!bypass) {
      return super.$transaction(arg1, arg2);
    }

    if (typeof arg1 === 'function') {
      return super.$transaction(async (tx) => {
        if (tx && (tx as any).outboxEvent) {
          (tx as any).outboxEvent.create = (async (args: any) => {
            const { type, payload } = args.data;
            this.logger.log(`[Outbox Bypass (Tx)] Intercepted transaction write of type: ${type}. Routing directly to BullMQ.`);
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
              this.logger.error(`[Outbox Bypass (Tx)] Failed to direct-publish to outbox-events queue: ${err}`);
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
          }) as any;
        }
        return arg1(tx);
      }, arg2);
    }

    return super.$transaction(arg1, arg2);
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
