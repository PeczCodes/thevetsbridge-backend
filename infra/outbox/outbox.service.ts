import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('outbox-events')
    private readonly outboxQueue: Queue,
  ) {}

  async processUnpublishedEvents() {
    await this.prisma.$transaction(async (tx) => {
      // Fetch and lock unpublished events inside the transaction
      const events = await tx.$queryRaw<any[]>`
        SELECT *
        FROM "OutboxEvent"
        WHERE "published" = false
        ORDER BY "createdAt" ASC
        LIMIT 100
        FOR UPDATE SKIP LOCKED
      `;

      if (events.length === 0) {
        return;
      }

      this.logger.log(`Found ${events.length} unpublished event(s).`);

      for (const event of events) {
        try {
          this.logger.log(
            `Queueing outbox event ${event.id} of type ${event.type}`,
          );

          await this.outboxQueue.add(
            'process-event',
            {
              eventId: event.id,
              type: event.type,
              payload: event.payload,
            },
            {
              jobId: event.id,
              attempts: 5,
              backoff: {
                type: 'exponential',
                delay: 2000,
              },
            },
          );

          await tx.outboxEvent.update({
            where: { id: event.id },
            data: {
              published: true,
              publishedAt: new Date(),
            },
          });
        } catch (error) {
          this.logger.error(
            `Failed to publish event ${event.id} to queue`,
            error,
          );
          throw error; // Rollback transaction so we retry next time
        }
      }
    });
  }
}
