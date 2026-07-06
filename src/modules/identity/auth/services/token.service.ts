import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../../../infra/prisma/prisma.service';
import { HashingService } from './hash.service';
import { randomUUID } from 'crypto';

interface Payload {
  sub: string;
  email: string;
  sid?: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly hashingService: HashingService,
    private readonly configService: ConfigService,
  ) {}

  async issueAuthTokens(
    userId: string,
    email: string,
    context?: { ip?: string; ua?: string },
  ) {
    const sessionId = randomUUID();

    const accessTokenPayload = {
      sub: userId,
      email: email,
    };

    const refreshTokenPayload = {
      sub: userId,
      email: email,
      sid: sessionId,
    };

    const refreshSecret =
      this.configService.getOrThrow<string>('JWT_REFRESH_SECRET');

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessTokenPayload, {
        expiresIn: '15m',
        // access tokens use the module-default JWT_ACCESS_SECRET
      }),
      this.jwtService.signAsync(refreshTokenPayload, {
        expiresIn: '7d',
        secret: refreshSecret, // refresh tokens use a separate secret
      }),
    ]);

    const refreshTokenHash = await this.hashingService.hash(refreshToken);

    // Store session in DB
    await this.prisma.session.create({
      data: {
        id: sessionId,
        userId,
        refreshTokenHash,
        ipAddress: context?.ip,
        userAgent: context?.ua,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    return {
      accessToken,
      refreshToken,
    };
  }

  async issueFreshAuthTokens(
    refreshToken: string,
    context?: { ip?: string; ua?: string },
  ) {
    let payload: Payload;

    const refreshSecret =
      this.configService.getOrThrow<string>('JWT_REFRESH_SECRET');

    try {
      payload = await this.jwtService.verifyAsync<Payload>(refreshToken, {
        secret: refreshSecret, // must verify with the same secret used during signing
      });
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (!payload.sid) {
      throw new UnauthorizedException('Invalid token payload');
    }

    // Retrieve session by primary key
    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
    });

    if (!session || session.isRevoked || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session is invalid or expired');
    }

    // Verify token against hash
    const isValid = await this.hashingService.verify(
      session.refreshTokenHash,
      refreshToken,
    );
    if (!isValid) {
      // Security: token is valid JWT but doesn't match the stored hash — possible reuse attack.
      // Revoke the session immediately to protect the account.
      await this.prisma.session
        .update({
          where: { id: payload.sid },
          data: { isRevoked: true },
        })
        .catch(() => null);
      throw new UnauthorizedException('Token verification failed');
    }

    // Issue new tokens FIRST, then rotate session atomically.
    // We do NOT delete the session before issuing new tokens to prevent a race condition
    // where concurrent refresh attempts leave the user with no valid session.
    const newSessionId = randomUUID();

    const accessTokenPayload = { sub: session.userId, email: payload.email };
    const refreshTokenPayload = {
      sub: session.userId,
      email: payload.email,
      sid: newSessionId,
    };

    const [newAccessToken, newRefreshToken] = await Promise.all([
      this.jwtService.signAsync(accessTokenPayload, { expiresIn: '15m' }),
      this.jwtService.signAsync(refreshTokenPayload, {
        expiresIn: '7d',
        secret: refreshSecret,
      }),
    ]);

    const newRefreshTokenHash = await this.hashingService.hash(newRefreshToken);

    // Atomically: revoke old session + create new session in a single transaction
    await this.prisma.$transaction([
      this.prisma.session.update({
        where: { id: payload.sid },
        data: { isRevoked: true },
      }),
      this.prisma.session.create({
        data: {
          id: newSessionId,
          userId: session.userId,
          refreshTokenHash: newRefreshTokenHash,
          ipAddress: context?.ip,
          userAgent: context?.ua,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      }),
    ]);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }

  async revokeSession(refreshToken: string) {
    const refreshSecret =
      this.configService.getOrThrow<string>('JWT_REFRESH_SECRET');
    try {
      const payload = await this.jwtService.verifyAsync<Payload>(refreshToken, {
        secret: refreshSecret,
      });
      if (payload.sid) {
        await this.prisma.session.delete({
          where: { id: payload.sid },
        });
      }
    } catch (error) {
      // Ignore token verification errors during logout / revocation
    }
  }
}
