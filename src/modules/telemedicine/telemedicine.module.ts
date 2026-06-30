import { Module } from '@nestjs/common';
import { ConsultationsService } from './consultations/consultations.service';
import { PrescriptionsService } from './prescriptions/prescriptions.service';
import { ConsultationsController } from './consultations/consultations.controller';
import { PrescriptionsController } from './prescriptions/prescriptions.controller';
import { VetsController } from './vets/vets.controller';
import { VetAvailabilityController } from './vets/vet-availability.controller';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AnimalsModule } from '../animals/animals.module';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelemedicineGateway } from './gateways/telemedicine.gateway';
import { DirectMessagingService } from './direct-messaging/direct-messaging.service';
import { DirectMessagingController } from './direct-messaging/direct-messaging.controller';
import { VetsService } from './vets/vets.service';
import { BullModule } from '@nestjs/bullmq';
import { UnpaidBookingCleanupProcessor } from './consultations/services/unpaid-booking-cleanup.processor';

@Module({
  imports: [
    PrismaModule,
    AnimalsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_ACCESS_SECRET'),
      }),
    }),
    BullModule.registerQueue({
      name: 'unpaid-booking-cleanup',
    }),
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
  ],
  exports: [ConsultationsService, PrescriptionsService, DirectMessagingService],
})
export class TelemedicineModule {}
