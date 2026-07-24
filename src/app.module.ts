import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import pinoConfig from 'src/logger/pino.config';
import { InfraModule } from '../infra/infra.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { IdentityModule } from './modules/identity/identity.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { AnimalsModule } from './modules/animals/animals.module';
import { TelemedicineModule } from './modules/telemedicine/telemedicine.module';
import { MarketplaceModule } from './modules/ecommerce/marketplace/marketplace.module';
import { AdminModule } from './modules/admin/admin.module';
import { SearchModule } from './modules/search/search.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { MediaModule } from './modules/media/media.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MonitoringModule } from './monitoring/monitoring.module';
import { HttpMetricsInterceptor } from './monitoring/interceptors/http-metrics.interceptor';
import { ExceptionMonitoringFilter } from './monitoring/interceptors/exception-monitoring.filter';
import { appConfig } from '../config/app.config';
import { redisConfig } from '../config/redis.config';
import { paystackConfig } from '../config/paystack.config';
import { cloudinaryConfig } from '../config/cloudinary.config';
import { envSchema } from '../config/env/env.schema';
import { googleConfig } from '../config/google.config';
import { livekitConfig } from '../config/livekit.config';
import { throttlerConfig } from '../config/throttler.config';
import { circuitBreakerConfig } from '../config/circuit-breaker.config';
import { telemedicineConfig } from '../config/telemedicine.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig,
        redisConfig,
        paystackConfig,
        cloudinaryConfig,
        googleConfig,
        livekitConfig,
        throttlerConfig,
        circuitBreakerConfig,
        telemedicineConfig,
      ],
      validate: (env) => envSchema.parse(env),
    }),
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: pinoConfig,
    }),
    MonitoringModule,
    InfraModule,
    IdentityModule,
    OrganizationsModule,
    AnimalsModule,
    TelemedicineModule,
    MarketplaceModule,
    AdminModule,
    SearchModule,
    PaymentsModule,
    MediaModule,
    NotificationsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpMetricsInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: ExceptionMonitoringFilter,
    },
  ],
})
export class AppModule {}
