import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    // 1. Authenticated users are throttled by their unique User ID.
    // This prevents NAT/office IP collisions (e.g. all clinic staff sharing an IP)
    // and stops proxy-rotating attackers from bypassing per-account rate limits.
    if (req.user?.id) {
      return `user:${req.user.id}`;
    }

    // 2. Resolve client IP accurately for unauthenticated requests (Cloudflare / reverse proxy headers)
    const cfConnectingIp = req.headers?.['cf-connecting-ip'];
    if (typeof cfConnectingIp === 'string' && cfConnectingIp.trim().length > 0) {
      return cfConnectingIp.trim();
    }

    const xRealIp = req.headers?.['x-real-ip'];
    if (typeof xRealIp === 'string' && xRealIp.trim().length > 0) {
      return xRealIp.trim();
    }

    // Fall back to Express resolved IP / ips array (leveraging express 'trust proxy')
    return req.ips?.length ? req.ips[0] : req.ip;
  }
}
