import { AppThrottlerGuard } from './app-throttler.guard';
import { Reflector } from '@nestjs/core';

describe('AppThrottlerGuard', () => {
  let guard: AppThrottlerGuard;

  beforeEach(() => {
    const options = { throttlers: [{ limit: 10, ttl: 60 }] };
    const storageService = { increment: jest.fn() } as any;
    const reflector = new Reflector();

    guard = new AppThrottlerGuard(options, storageService, reflector);
  });

  describe('getTracker', () => {
    it('should track by user ID when user is authenticated', async () => {
      const req = {
        user: { id: 'user_abc123' },
        ip: '192.168.1.1',
      };

      const tracker = await (guard as any).getTracker(req);
      expect(tracker).toBe('user:user_abc123');
    });

    it('should track by CF-Connecting-IP header for unauthenticated requests when present', async () => {
      const req = {
        headers: {
          'cf-connecting-ip': '203.0.113.195',
        },
        ip: '10.0.0.1',
      };

      const tracker = await (guard as any).getTracker(req);
      expect(tracker).toBe('203.0.113.195');
    });

    it('should track by X-Real-IP header when present and not behind Cloudflare', async () => {
      const req = {
        headers: {
          'x-real-ip': '198.51.100.22',
        },
        ip: '10.0.0.1',
      };

      const tracker = await (guard as any).getTracker(req);
      expect(tracker).toBe('198.51.100.22');
    });

    it('should fall back to req.ips[0] or req.ip when no headers or user present', async () => {
      const reqWithIps = {
        ips: ['198.51.100.5', '10.0.0.1'],
        ip: '10.0.0.1',
      };

      const tracker1 = await (guard as any).getTracker(reqWithIps);
      expect(tracker1).toBe('198.51.100.5');

      const reqWithIpOnly = {
        ip: '198.51.100.99',
      };

      const tracker2 = await (guard as any).getTracker(reqWithIpOnly);
      expect(tracker2).toBe('198.51.100.99');
    });
  });
});
