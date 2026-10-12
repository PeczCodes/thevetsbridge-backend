import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Get,
  UseGuards,
  Res,
  Req,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import {
  RegisterDto,
  LinkVetProfileDto,
  LinkVendorProfileDto,
} from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { RequireProfile } from './decorators/require-profile.decorator';
import { RequireProfileGuard } from './guards/require-profile.guard';
import * as express from 'express';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  private setRefreshTokenCookie(res: express.Response, token: string) {
    const nodeEnv = this.configService.getOrThrow<string>('app.env');
    const isProd = nodeEnv === 'production';

    res.cookie('refreshToken', token, {
      httpOnly: true,
      sameSite: isProd ? 'strict' : 'none',
      secure: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      domain: isProd ? '.vetsbridge.org' : undefined,
    });
  }

  private setAccessTokenCookie(res: express.Response, token: string) {
    const nodeEnv = this.configService.getOrThrow<string>('app.env');
    const isProd = nodeEnv === 'production';

    res.cookie('accessToken', token, {
      httpOnly: true,
      sameSite: isProd ? 'strict' : 'none',
      secure: true,
      maxAge: 15 * 60 * 1000,
      domain: isProd ? '.vetsbridge.org' : undefined,
    });
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('register')
  async register(
    @Body() registerDto: RegisterDto,
    @Req() req: express.Request,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    const context = {
      ip: req.ip,
      ua: req.headers['user-agent'],
    };

    const { user, tokens } = await this.authService.register(
      registerDto,
      context,
    );
    this.setRefreshTokenCookie(res, tokens.refreshToken);
    this.setAccessTokenCookie(res, tokens.accessToken);

    return {
      success: true,
      user,
    };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Req() req: express.Request,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    const context = {
      ip: req.ip,
      ua: req.headers['user-agent'],
    };

    const { user, tokens } = await this.authService.login(loginDto, context);
    this.setRefreshTokenCookie(res, tokens.refreshToken);
    this.setAccessTokenCookie(res, tokens.accessToken);

    return {
      success: true,
      user,
    };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: express.Request,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    const token = req.cookies['refreshToken'];
    if (!token) {
      throw new UnauthorizedException('Refresh token is missing');
    }
    const context = {
      ip: req.ip,
      ua: req.headers['user-agent'],
    };

    const tokens = await this.authService.refresh(token, context);
    this.setRefreshTokenCookie(res, tokens.refreshToken);
    this.setAccessTokenCookie(res, tokens.accessToken);

    return {
      success: true,
    };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: express.Request,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    const token = req.cookies['refreshToken'];
    if (token) {
      await this.authService.logout(token);
    }

    const nodeEnv = this.configService.get<string>('app.env') ?? 'development';
    const isProd = nodeEnv === 'production';

    res.clearCookie('accessToken', {
      httpOnly: true,
      sameSite: isProd ? 'strict' : 'none',
      secure: true,
      domain: isProd ? '.vetsbridge.org' : undefined,
    });

    res.clearCookie('refreshToken', {
      httpOnly: true,
      sameSite: isProd ? 'strict' : 'none',
      secure: true,
      domain: isProd ? '.vetsbridge.org' : undefined,
    });

    return {
      success: true,
    };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Get('check-email')
  async checkEmail(@Query('email') email: string) {
    return this.authService.checkEmail(email);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('register-vet')
  async registerVet(
    @Body() registerDto: RegisterDto,
    @Req() req: express.Request,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    if (!registerDto.vetProfile) {
      // licenseNumber is nullable (String? @unique) — nulls are not subject to the unique constraint.
      // Vets can register without a license number and submit it later during profile completion.
      registerDto.vetProfile = {
        licenseNumber: undefined,
        licenseCountry: 'Nigeria',
        licenseDocUrl: '',
      };
    } else if (registerDto.vetProfile.licenseNumber) {
      const trimmed = registerDto.vetProfile.licenseNumber.trim();
      registerDto.vetProfile.licenseNumber =
        trimmed === '' || trimmed.toUpperCase() === 'PENDING'
          ? undefined
          : trimmed;
    }
    const context = {
      ip: req.ip,
      ua: req.headers['user-agent'],
    };

    const { user, tokens } = await this.authService.register(
      registerDto,
      context,
    );
    this.setRefreshTokenCookie(res, tokens.refreshToken);
    this.setAccessTokenCookie(res, tokens.accessToken);

    return {
      success: true,
      user,
    };
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('register-vendor')
  async registerVendor(
    @Body() registerDto: RegisterDto,
    @Req() req: express.Request,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    if (!registerDto.vendorProfile) {
      registerDto.vendorProfile = {};
    }
    const context = {
      ip: req.ip,
      ua: req.headers['user-agent'],
    };

    const { user, tokens } = await this.authService.register(
      registerDto,
      context,
    );
    this.setRefreshTokenCookie(res, tokens.refreshToken);
    this.setAccessTokenCookie(res, tokens.accessToken);

    return {
      success: true,
      user,
    };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('verify-password')
  @HttpCode(HttpStatus.OK)
  async verifyPassword(@Body() body: LoginDto) {
    // verifyPassword now checks lockout and throws on failure —
    // returning false only happens for no-account / Google-only users.
    const isValid = await this.authService.verifyPassword(
      body.email,
      body.password,
    );
    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return { success: true };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('link-vet-profile')
  @HttpCode(HttpStatus.OK)
  async linkVetProfile(
    @Body() body: LinkVetProfileDto,
    @Req() req: express.Request,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    const context = {
      ip: req.ip,
      ua: req.headers['user-agent'],
    };

    const sanitizedLicense = body.licenseNumber?.trim();
    const finalLicenseNumber =
      !sanitizedLicense || sanitizedLicense.toUpperCase() === 'PENDING'
        ? undefined
        : sanitizedLicense;

    // linkVetProfile now returns { vetProfile, user } and internally handles
    // lockout, isActive, and recordFailedAttempt — no second login call needed.
    const { vetProfile, user } = await this.authService.linkVetProfile(
      body.email,
      body.password,
      {
        licenseNumber: finalLicenseNumber,
        specializations: body.specializations,
        experience: body.experience,
        bio: body.bio,
      },
    );

    const tokens = await this.authService.issueAuthTokens(
      user.id,
      user.email,
      context,
    );
    this.setRefreshTokenCookie(res, tokens.refreshToken);
    this.setAccessTokenCookie(res, tokens.accessToken);

    return {
      success: true,
      user,
      vetProfile,
    };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('link-vendor-profile')
  @HttpCode(HttpStatus.OK)
  async linkVendorProfile(
    @Body() body: LinkVendorProfileDto,
    @Req() req: express.Request,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    const context = {
      ip: req.ip,
      ua: req.headers['user-agent'],
    };

    // linkVendorProfile now returns { vendorProfile, user } — no second login call needed.
    const { vendorProfile, user } = await this.authService.linkVendorProfile(
      body.email,
      body.password,
      {
        businessName: body.businessName,
        businessPhone: body.businessPhone,
        businessAddress: body.businessAddress,
        bio: body.bio,
      },
    );

    const tokens = await this.authService.issueAuthTokens(
      user.id,
      user.email,
      context,
    );
    this.setRefreshTokenCookie(res, tokens.refreshToken);
    this.setAccessTokenCookie(res, tokens.accessToken);

    return {
      success: true,
      user,
      vendorProfile,
    };
  }

  @Get('me')
  async getProfile(@CurrentUser() user: any) {
    return user;
  }

  // Example of PBAC protected route
  @Get('vet-dashboard')
  @RequireProfile('VET')
  @UseGuards(RequireProfileGuard)
  async vetDashboard(@CurrentUser() user: any) {
    return {
      message: 'Welcome to the Vet Dashboard',
      vetProfile: user.vetProfile,
    };
  }

  @Public()
  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleAuth(@Req() req) {}

  @Public()
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleAuthRedirect(@Req() req: any, @Res() res: express.Response) {
    const user = req.user;
    const frontendUrl = this.configService.getOrThrow<string>('FRONTEND_URL');

    if (!user) {
      return res.redirect(`${frontendUrl}/auth/login?error=auth_failed`);
    }

    const context = {
      ip: req.ip,
      ua: req.headers['user-agent'],
    };

    // Issue auth tokens
    const tokens = await this.authService.issueAuthTokens(
      user.id,
      user.email,
      context,
    );
    this.setRefreshTokenCookie(res, tokens.refreshToken);
    this.setAccessTokenCookie(res, tokens.accessToken);

    return res.redirect(`${frontendUrl}/dashboard`);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() req: express.Request,
  ) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const ua = req.headers['user-agent'] || 'unknown';
    await this.authService.requestPasswordReset(dto.email, ip, ua);
    return {
      message:
        'If an account with that email exists, a password reset link has been sent.',
    };
  }

  @Public()
  @Get('reset-password/validate')
  @HttpCode(HttpStatus.OK)
  async validateResetToken(@Query('token') token: string) {
    return this.authService.validateResetToken(token);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() req: express.Request,
  ) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const ua = req.headers['user-agent'] || 'unknown';
    await this.authService.resetPassword(dto, ip, ua);
    return {
      success: true,
      message: 'Password reset successfully.',
    };
  }
}
