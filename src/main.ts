import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RedisIoAdapter } from '../infra/adapters/redis-io.adapter';
import cookieParser from 'cookie-parser';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    bufferLogs: true,
    abortOnError: false,
  });

  app.useLogger(app.get(PinoLogger));

  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('trust proxy', 1);

  const configService = app.get(ConfigService);
  const logger = new Logger('App');
  const port = configService.getOrThrow('app.port');
  const nodeEnv = configService.get<string>('app.env') ?? 'development';
  const corsOrigins = configService.get<string[]>('app.corsOrigins');
  const API_VERSION = '1';

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  app.use(cookieParser());
  
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: API_VERSION,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  const isSwaggerEnabled = process.env.SWAGGER_ENABLED !== 'false';

  if (isSwaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('VetsBridge API')
      .setDescription(
        'Production-grade veterinary ecommerce backend API. ' +
          'Includes auth, vet profiles, appointments, ecommerce, payments, and real-time messaging.',
      )
      .setVersion('1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'Authorization',
          description: 'Enter JWT access token',
          in: 'header',
        },
        'Bearer',
      )
      .addTag('Payments', 'Payment processing & transactions')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
    });
  }

  
  const redisIoAdapter = new RedisIoAdapter(app);
  try {
    await redisIoAdapter.connectToRedis();
    app.useWebSocketAdapter(redisIoAdapter);
  } catch (err) {
    logger.warn(
      `Redis adapter unavailable, using default Socket.IO adapter: ${(err as Error).message}`,
    );
  }
  
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  app.enableShutdownHooks();

  await app.listen(port, '0.0.0.0');

  logger.log(
    `Application is running on port: ${port}, version: ${API_VERSION}`,
  );
}

bootstrap().catch((err) => {
  console.error('Failed to start application', err);
  process.exit(1);
});
