import { Module, forwardRef } from '@nestjs/common';
import { ConsultationsService } from './consultations/consultations.service';
import { PrescriptionsService } from './prescriptions/prescriptions.service';
import { ConsultationsController } from './consultations/consultations.controller';
import { PrescriptionsController } from './prescriptions/prescriptions.controller';
import { VetsController } from './vets/vets.controller';
import { VetAvailabilityController } from './vets/vet-availability.controller';
import { PrismaModule } from '../../../infra/prisma/prisma.module';
import { IdentityModule } from '../identity/identity.module';
import { AnimalsModule } from '../animals/animals.module';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelemedicineGateway } from './gateways/telemedicine.gateway';
import { DirectMessagingService } from './direct-messaging/direct-messaging.service';
import { DirectMessagingController } from './direct-messaging/direct-messaging.controller';
import { VetsService } from './vets/vets.service';
import { BullModule } from '@nestjs/bullmq';
import { UnpaidBookingCleanupProcessor } from './consultations/services/unpaid-booking-cleanup.processor';
import { ConsultationLifecycleWorker } from './consultations/services/consultation-lifecycle.worker';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationsQueueModule } from '../../../infra/queues/notifications-queue/notifications-queue.module';
import { AppointmentLifecycleService } from './consultations/services/appointment-lifecycle.service';

@Module({
  imports: [
    PrismaModule,
    AnimalsModule,
    IdentityModule,
    forwardRef(() => PaymentsModule),
    NotificationsQueueModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_ACCESS_SECRET'),
      }),
    }),
    BullModule.registerQueue(
      { name: 'unpaid-booking-cleanup' },
      { name: 'consultation-lifecycle' },
    ),
  ],
  controllers: [
    ConsultationsController,
    PrescriptionsController,
    DirectMessagingController,
    VetsController,
    VetAvailabilityController,
  ],
  providers: [
    ConsultationsService,
    PrescriptionsService,
    TelemedicineGateway,
    DirectMessagingService,
    VetsService,
    UnpaidBookingCleanupProcessor,
    ConsultationLifecycleWorker,
    AppointmentLifecycleService,
  ],
  exports: [ConsultationsService, PrescriptionsService, DirectMessagingService, AppointmentLifecycleService],
})
export class TelemedicineModule {}
