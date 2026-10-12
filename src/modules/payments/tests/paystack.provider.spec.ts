import { PaystackProvider } from '../providers/paystack.provider';
import { ConfigService } from '@nestjs/config';
import { CircuitBreakerService } from '../../../../infra/circuit-breaker/circuit-breaker.service';
import * as crypto from 'crypto';

describe('PaystackProvider', () => {
  let provider: PaystackProvider;
  let configServiceMock: any;
  let circuitBreakerMock: any;
  const secretKey = 'sk_test_secret_key_12345';

  beforeEach(() => {
    configServiceMock = {
      get: jest.fn().mockReturnValue(secretKey),
    };

    circuitBreakerMock = {
      execute: jest.fn(),
    };

    provider = new PaystackProvider(configServiceMock, circuitBreakerMock);
  });

  describe('verifyWebhookSignature', () => {
    it('should return true for valid HMAC SHA512 signature in constant time', () => {
      const rawBody = JSON.stringify({ event: 'charge.success', data: { id: 123 } });
      const validSignature = crypto
        .createHmac('sha512', secretKey)
        .update(rawBody)
        .digest('hex');

      expect(provider.verifyWebhookSignature(validSignature, rawBody)).toBe(true);
    });

    it('should return false for invalid HMAC SHA512 signature', () => {
      const rawBody = JSON.stringify({ event: 'charge.success', data: { id: 123 } });
      const invalidSignature = 'invalid_signature_hex_digest_value';

      expect(provider.verifyWebhookSignature(invalidSignature, rawBody)).toBe(false);
    });

    it('should return false if secretKey is DISABLED', () => {
      configServiceMock.get.mockReturnValue('DISABLED');
      const disabledProvider = new PaystackProvider(configServiceMock, circuitBreakerMock);

      expect(disabledProvider.verifyWebhookSignature('sig', 'body')).toBe(false);
    });

    it('should return false for empty signature or empty rawBody', () => {
      expect(provider.verifyWebhookSignature('', 'body')).toBe(false);
      expect(provider.verifyWebhookSignature('sig', '')).toBe(false);
    });
  });
});
