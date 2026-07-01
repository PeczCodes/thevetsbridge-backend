import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { InfraModule } from '../infra/infra.module';
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
import { PaymentsModule } from './modules/payments/payments.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { appConfig } from '../config/app.config';
import { prismaConfig } from '../config/prisma.config';
import { redisConfig } from '../config/redis.config';
import { paystackConfig } from '../config/paystack.config';
import { cloudinaryConfig } from '../config/cloudinary.config';
import { envSchema } from '../config/env/env.schema';
import { googleConfig } from '../config/google.config';
import { livekitConfig } from '../config/livekit.config';
import { throttlerConfig } from '../config/throttler.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, prismaConfig, redisConfig, paystackConfig, cloudinaryConfig, googleConfig, livekitConfig, throttlerConfig],
      validate: (env) => envSchema.parse(env),
    }),
    InfraModule,
    IdentityModule,
    OrganizationsModule,
    AnimalsModule,
    TelemedicineModule,
    MarketplaceModule,
    AdminModule,
    SearchModule,
    PaymentsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
