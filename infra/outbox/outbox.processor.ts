import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { OutboxService } from './outbox.service';

@Injectable()
export class OutboxProcessor implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxProcessor.name);
  private isProcessing = false;
  private pollingInterval: NodeJS.Timeout;

  constructor(private readonly outboxService: OutboxService) {}

  onApplicationBootstrap() {
    this.startPolling();
  }

  onModuleDestroy() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }
  }

  private startPolling() {
    this.pollingInterval = setInterval(async () => {
      if (this.isProcessing) return;
      this.isProcessing = true;
      try {
        await this.outboxService.processUnpublishedEvents();
      } catch (error) {
        this.logger.error('Error during outbox polling', error);
      } finally {
        this.isProcessing = false;
      }
    }, 5000);
  }
}
