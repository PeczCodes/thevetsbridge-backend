import { registerAs } from '@nestjs/config';

export interface ProviderBreakerConfig {
  timeout: number;
  resetTimeout: number;
  errorThresholdPercentage: number;
  rollingCountBuckets: number;
  rollingCountTimeout: number;
}

export interface CircuitBreakerConfig {
  timeout: number;
  resetTimeout: number;
  errorThresholdPercentage: number;
  rollingCountBuckets: number;
  rollingCountTimeout: number;
  providers: {
    paystack: ProviderBreakerConfig;
    cloudinary: ProviderBreakerConfig;
    resend: ProviderBreakerConfig;
  };
}

export const circuitBreakerConfig = registerAs('circuitBreaker', () => {
  const defaultTimeout = process.env.CIRCUIT_BREAKER_TIMEOUT || '20000';
  const defaultResetTimeout = process.env.CIRCUIT_BREAKER_RESET_TIMEOUT || '30000';
  const defaultErrorThreshold = process.env.CIRCUIT_BREAKER_ERROR_THRESHOLD || '50';
  const defaultRollingBuckets = process.env.CIRCUIT_BREAKER_ROLLING_BUCKETS || '10';
  const defaultRollingTimeout = process.env.CIRCUIT_BREAKER_ROLLING_TIMEOUT || '10000';

  return {
    timeout: defaultTimeout,
    resetTimeout: defaultResetTimeout,
    errorThresholdPercentage: defaultErrorThreshold,
    rollingCountBuckets: defaultRollingBuckets,
    rollingCountTimeout: defaultRollingTimeout,
    providers: {
      paystack: {
        timeout: process.env.PAYSTACK_CIRCUIT_TIMEOUT || '20000',
        resetTimeout: process.env.PAYSTACK_CIRCUIT_RESET_TIMEOUT || '30000',
        errorThresholdPercentage: defaultErrorThreshold,
        rollingCountBuckets: defaultRollingBuckets,
        rollingCountTimeout: defaultRollingTimeout,
      },
      cloudinary: {
        timeout: process.env.CLOUDINARY_CIRCUIT_TIMEOUT || '20000',
        resetTimeout: process.env.CLOUDINARY_CIRCUIT_RESET_TIMEOUT || '30000',
        errorThresholdPercentage: defaultErrorThreshold,
        rollingCountBuckets: defaultRollingBuckets,
        rollingCountTimeout: defaultRollingTimeout,
      },
      resend: {
        timeout: process.env.RESEND_CIRCUIT_TIMEOUT || '20000',
        resetTimeout: process.env.RESEND_CIRCUIT_RESET_TIMEOUT || '30000',
        errorThresholdPercentage: defaultErrorThreshold,
        rollingCountBuckets: defaultRollingBuckets,
        rollingCountTimeout: defaultRollingTimeout,
      },
    },
  };
});
