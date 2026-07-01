import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RedisIoAdapter } from '../infra/adapters/redis-io.adapter';
import cookieParser from 'cookie-parser';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('trust proxy', true);

  const configService = app.get(ConfigService);
  const port = configService.getOrThrow('app.port', 3000)
  const logger = new Logger('App')
  const API_VERSION = '1'
  
  app.enableCors({
    origin: [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
      'https://balcony-crabgrass-campus.ngrok-free.dev',
    ],
    credentials: true,
  });
  
  app.use(cookieParser());
  
  app.setGlobalPrefix('api');
  
  app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: API_VERSION
  })
  
  
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
  
  const swaggerConfig = new DocumentBuilder()
    .setTitle('VetsBridge API')
    .setDescription(
      'Production-grade veterinary marketplace backend API. ' +
      'Includes auth, vet profiles, appointments, marketplace, payments, and real-time messaging.'
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

  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis();
  
  app.useWebSocketAdapter(redisIoAdapter);

  await app.listen(port)
  
  logger.log(`Application is running port: ${port}, version: ${API_VERSION}`);
}

bootstrap();
