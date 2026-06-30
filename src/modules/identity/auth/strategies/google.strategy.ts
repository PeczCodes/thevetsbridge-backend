import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      clientID: configService.getOrThrow<string>('google.oauth.clientId'),
      clientSecret: configService.getOrThrow<string>('google.oauth.clientSecret'),
      callbackURL: configService.getOrThrow<string>('google.oauth.callbackUrl'),
      scope: ['email', 'profile'],
    });
  }

  async validate(accessToken: string, refreshToken: string, profile: any, done: VerifyCallback): Promise<any> {
    const { name, emails, photos } = profile;
    const googleUser = {
      email: emails[0].value,
      firstName: name.givenName || 'GoogleUser',
      lastName: name.familyName || '',
      avatarUrl: photos?.[0]?.value || null,
    };

    try {
      const user = await this.authService.validateOrCreateGoogleUser(googleUser);
      done(null, user as any);
    } catch (err) {
      done(err as any, undefined);
    }
  }
}
