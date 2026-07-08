import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { OutboxService } from './outbox.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class OutboxProcessor implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxProcessor.name);
  private isProcessing = false;
  private pollingInterval: NodeJS.Timeout;

  constructor(
    private readonly outboxService: OutboxService,
    private readonly configService: ConfigService,
  ) {}

  onApplicationBootstrap() {
    const bypass = this.configService.get<boolean>('app.bypassOutbox') ?? false;
    if (bypass) {
      this.logger.log('Transactional Outbox polling is disabled (bypassed).');
      return;
    }
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
