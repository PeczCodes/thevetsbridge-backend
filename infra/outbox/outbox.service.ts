import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);
  private failed = []
 
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('outbox-events')
    private readonly outboxQueue: Queue,
  ) {}

  async processUnpublishedEvents() {
    
    const unpublished = await this.prisma.$queryRaw<any[]>`
        SELECT *
        FROM "OutboxEvent"
        WHERE "published" = false
        ORDER BY "createdAt" ASC
        LIMIT 100
        FOR UPDATE SKIP LOCKED
      `;

    
    if (!unpublished.length) return;
    
    
    for (const event of unpublished) {
      try {
        await this.outboxQueue.add('process-event',
          {
            eventId: event.id,
            type: event.type,
            payload: event.payload
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
        
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            published: true,
            publishedAt: new Date(),
          },
        })
      }
      
      catch (error) {
        this.logger.error(
          `Failed to publish event ${event.id} to queue`,
          error,
        );
        throw error;
      }
    }
  }
}
