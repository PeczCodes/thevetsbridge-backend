import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MetricsAuthGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const isEnabled = this.configService.get<string>('METRICS_ENABLED') !== 'false';
    if (!isEnabled) {
      throw new NotFoundException('Metrics endpoint is disabled.');
    }

    const isAuthEnabled = this.configService.get<string>('METRICS_AUTH_ENABLED') === 'true';
    if (!isAuthEnabled) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const apiKey = this.configService.get<string>('METRICS_API_KEY');

    if (!apiKey) {
      throw new ForbiddenException('Metrics authentication is enabled but no API key is configured.');
    }

    const headerApiKey = request.headers['x-api-key'];
    const authHeader = request.headers['authorization'];
    let providedKey = headerApiKey;

    if (!providedKey && authHeader && authHeader.startsWith('Bearer ')) {
      providedKey = authHeader.substring(7).trim();
    }

    if (!providedKey || providedKey !== apiKey) {
      throw new UnauthorizedException('Invalid or missing metrics API key.');
    }

    return true;
  }
}
