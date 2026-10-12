import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UsersService } from './users/users.service';
import { AuthService } from './auth/auth.service';
import { JwtStrategy } from './auth/strategies/jwt.strategy';
import { GoogleStrategy } from './auth/strategies/google.strategy';
import { AuthController } from './auth/auth.controller';
import { UsersController } from './users/users.controller';
import { UserController } from './users/user.controller';
import { AddressesService } from './addresses/addresses.service';
import { AddressesController } from './addresses/addresses.controller';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { TokenService } from './auth/services/token.service';
import { HashingService } from './auth/services/hash.service';
import { SessionCleanupProcessor } from './auth/services/session-cleanup.processor';
import { AccountLockoutService } from './auth/services/account-lockout.service';
import { BullModule } from '@nestjs/bullmq';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: '1d' },
      }),
    }),
    BullModule.registerQueue({
      name: 'session-cleanup',
    }),
    MediaModule,
  ],
  controllers: [
    AuthController,
    UsersController,
    UserController,
    AddressesController,
  ],
  providers: [
    UsersService,
    AuthService,
    AddressesService,
    TokenService,
    HashingService,
    AccountLockoutService,
    JwtStrategy,
    GoogleStrategy,
    SessionCleanupProcessor,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard, // Protects all routes globally unless @Public()
    },
  ],
  exports: [
    UsersService,
    TokenService,
    HashingService,
    AccountLockoutService,
    AddressesService,
    JwtModule,
  ],
})
export class IdentityModule {}
