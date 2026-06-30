import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CoreModule } from './core/core.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { IdentityModule } from './modules/identity/identity.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { AnimalsModule } from './modules/animals/animals.module';
import { TelemedicineModule } from './modules/telemedicine/telemedicine.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { AdminModule } from './modules/admin/admin.module';
import { RequestLoggerMiddleware } from './middleware/requestLogger.middleware';
import { SearchModule } from './modules/search/search.module';
import { MetricsModule } from './metrics/metrics.module';
import { NotificationsQueueModule } from './core/notifications-queue/notifications-queue.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { CloudinaryModule } from './core/cloudinary/cloudinary.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { appConfig } from './core/config/app.config';
import { prismaConfig } from './core/config/prisma.config';
import { redisConfig } from './core/config/redis.config';
import { paystackConfig } from './core/config/paystack.config';
import { cloudinaryConfig } from './core/config/cloudinary.config';
import { envSchema } from './core/config/env/env.schema';
import { googleConfig } from './core/config/google.config';
import { livekitConfig } from './core/config/livekit.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, prismaConfig, redisConfig, paystackConfig, cloudinaryConfig, googleConfig, livekitConfig],
      validate: (env) => envSchema.parse(env),
    }),
    CoreModule,
    IdentityModule,
    OrganizationsModule,
    AnimalsModule,
    TelemedicineModule,
    MarketplaceModule,
    AdminModule,
    SearchModule,
    MetricsModule,
    NotificationsQueueModule,
    PaymentsModule,
    CloudinaryModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
