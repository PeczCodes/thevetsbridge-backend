import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly logger = new Logger(GoogleStrategy.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    const clientId =
      configService.get<string>('google.oauth.clientId') || 'DISABLED';
    const clientSecret =
      configService.get<string>('google.oauth.clientSecret') || 'DISABLED';
    const callbackUrl =
      configService.getOrThrow<string>('google.oauth.callbackUrl') ||
      'http://localhost/callback';

    super({
      clientID: clientId,
      clientSecret: clientSecret,
      callbackURL: callbackUrl,
      scope: ['email', 'profile'],
    });

    if (clientId === 'DISABLED' || clientSecret === 'DISABLED') {
      this.logger.warn(
        'Google OAuth is not configured. Google Sign-in will be unavailable.',
      );
    } else {
      // Test connectivity to Google accounts (simple ping check)
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 2000);
      fetch('https://accounts.google.com/.well-known/openid-configuration', {
        method: 'GET',
        signal: controller.signal,
      })
        .then(() => {
          this.logger.log('Google OAuth connected.');
        })
        .catch((err) => {
          this.logger.warn(
            `Google OAuth unavailable. Google Sign-in may fail. Error: ${err.message}`,
          );
        })
        .finally(() => clearTimeout(id));
    }
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<any> {
    const clientId =
      this.configService.get<string>('google.oauth.clientId') || 'DISABLED';
    if (clientId === 'DISABLED') {
      return done(
        new Error('Google Sign-in is temporarily unavailable.'),
        undefined,
      );
    }

    const { name, emails, photos } = profile;
    const googleUser = {
      email: emails[0].value,
      firstName: name.givenName || 'GoogleUser',
      lastName: name.familyName || '',
      avatarUrl: photos?.[0]?.value || null,
    };

    try {
      const user =
        await this.authService.validateOrCreateGoogleUser(googleUser);
      done(null, user as any);
    } catch (err) {
      done(err, undefined);
    }
  }
}
