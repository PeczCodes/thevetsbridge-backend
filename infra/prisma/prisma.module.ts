import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { BullModule } from '@nestjs/bullmq';

@Global()
@Module({
  imports: [
    BullModule.registerQueue({
      name: 'outbox-events',
    }),
  ],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
