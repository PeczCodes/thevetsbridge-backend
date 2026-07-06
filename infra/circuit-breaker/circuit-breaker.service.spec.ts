import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CircuitBreakerService } from './circuit-breaker.service';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('CircuitBreakerService', () => {
  let service: CircuitBreakerService;

  const mockConfig = {
    timeout: 1000,
    resetTimeout: 200,
    errorThresholdPercentage: 50,
    rollingCountBuckets: 10,
    rollingCountTimeout: 1000,
    providers: {
      paystack: {
        timeout: 500,
        resetTimeout: 300,
        errorThresholdPercentage: 50,
        rollingCountBuckets: 10,
        rollingCountTimeout: 1000,
      },
      cloudinary: {
        timeout: 1500,
        resetTimeout: 300,
        errorThresholdPercentage: 50,
        rollingCountBuckets: 10,
        rollingCountTimeout: 1000,
      },
      resend: {
        timeout: 800,
        resetTimeout: 300,
        errorThresholdPercentage: 50,
        rollingCountBuckets: 10,
        rollingCountTimeout: 1000,
      },
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CircuitBreakerService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(mockConfig),
          },
        },
      ],
    }).compile();

    service = module.get<CircuitBreakerService>(CircuitBreakerService);
  });

  it('should eagerly initialize paystack, cloudinary, and resend breakers', () => {
    const health = service.getHealth();
    const services = health.map((h) => h.service);
    expect(services).toContain('paystack');
    expect(services).toContain('cloudinary');
    expect(services).toContain('resend');
  });

  it('should reuse singleton breaker instances for the same service name', () => {
    const breaker1 = service.getBreaker('test-service');
    const breaker2 = service.getBreaker('test-service');
    expect(breaker1).toBe(breaker2);
  });

  it('should apply provider overrides correctly', () => {
    const breaker = service.getBreaker('paystack');
    expect((breaker as any).options.timeout).toBe(500);
    expect((breaker as any).options.resetTimeout).toBe(300);
    expect((breaker as any).options.errorThresholdPercentage).toBe(50);
  });

  it('should fail on execution timeout', async () => {
    const slowAction = async () => {
      await delay(200);
      return 'slow';
    };
    await expect(
      service.execute('slow-service', slowAction, { timeout: 50 }),
    ).rejects.toThrow();
  });

  it('should execute fallback on failure/trip', async () => {
    const failAction = async () => {
      throw new Error('boom');
    };
    const fallback = (err: any) => {
      expect(err.message).toBe('boom');
      return 'fallback-value';
    };

    const res = await service.execute('fallback-service', failAction, {}, fallback);
    expect(res).toBe('fallback-value');
  });

  it('should handle concurrent executions through the same breaker', async () => {
    const action = async () => {
      await delay(50);
      return 'ok';
    };

    const results = await Promise.all([
      service.execute('concurrent-service', action),
      service.execute('concurrent-service', action),
      service.execute('concurrent-service', action),
    ]);

    expect(results).toEqual(['ok', 'ok', 'ok']);
  });

  it('should trip (open) after error threshold and transition back to CLOSED on probe success', async () => {
    const failAction = async () => {
      throw new Error('fail');
    };

    const serviceName = 'trip-service';
    const breaker = service.getBreaker(serviceName, {
      errorThresholdPercentage: 10,
      resetTimeout: 100,
    });

    // Cause failure
    await expect(service.execute(serviceName, failAction)).rejects.toThrow('fail');
    expect(breaker.opened).toBe(true);

    // Call while open should reject immediately
    await expect(service.execute(serviceName, async () => 'ok')).rejects.toThrow('Breaker is open');

    // Wait for reset timeout cooldown
    await delay(150);
    expect(breaker.halfOpen).toBe(true);

    // Probe success should close circuit
    const successAction = async () => 'ok-recovered';
    const res = await service.execute(serviceName, successAction);
    expect(res).toBe('ok-recovered');
    expect(breaker.closed).toBe(true);
  });

  it('should expose accurate health diagnostics containing Opossum statistics', async () => {
    const serviceName = 'health-service';
    const action = async () => {
      await delay(10);
      return 'ok';
    };
    const failAction = async () => {
      throw new Error('fail');
    };

    await service.execute(serviceName, action);
    try {
      await service.execute(serviceName, failAction);
    } catch {}

    const health = service.getHealth();
    const serviceHealth = health.find((h) => h.service === serviceName);

    expect(serviceHealth).toBeDefined();
    expect(serviceHealth?.stats.successes).toBe(1);
    expect(serviceHealth?.stats.failures).toBe(1);
    expect(serviceHealth?.state).toBe('CLOSED');
    expect(serviceHealth?.stats.latencyMean).toBeDefined();
  });
});
