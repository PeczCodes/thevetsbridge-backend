import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Opossum from 'opossum';

export interface BreakerHealthInfo {
  service: string;
  state: string;
  stats: Opossum.Stats;
  options: Opossum.Options;
}

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private readonly breakers = new Map<string, Opossum<[() => Promise<any>], any>>();

  constructor(private readonly configService: ConfigService) {
    // Eagerly initialize circuit breakers for the known fixed integrations
    this.registerBreaker('paystack');
    this.registerBreaker('cloudinary');
    this.registerBreaker('resend');
  }

  /**
   * Registers a new breaker instance eagerly with merged options.
   */
  private registerBreaker(serviceName: string, customOptions?: Opossum.Options): Opossum<[() => Promise<any>], any> {
    const config = this.configService.get('circuitBreaker') || {};
    const providerOverrides = config.providers?.[serviceName] || {};

    const mergedOptions: Opossum.Options = {
      timeout: providerOverrides.timeout ?? config.timeout ?? 10000,
      resetTimeout: providerOverrides.resetTimeout ?? config.resetTimeout ?? 30000,
      errorThresholdPercentage: providerOverrides.errorThresholdPercentage ?? config.errorThresholdPercentage ?? 50,
      rollingCountBuckets: providerOverrides.rollingCountBuckets ?? config.rollingCountBuckets ?? 10,
      rollingCountTimeout: providerOverrides.rollingCountTimeout ?? config.rollingCountTimeout ?? 10000,
      ...customOptions,
    };

    // The breaker wraps a dynamic executor function that executes whatever action is passed at runtime
    const breaker = new Opossum<[() => Promise<any>], any>(
      async (runFn: () => Promise<any>) => runFn(),
      mergedOptions,
    );

    // Logging hooks for state transitions with useful production metadata
    breaker.on('open', () => {
      const stats = breaker.stats;
      const total = stats.successes + stats.failures;
      const failPercent = total > 0 ? (stats.failures / total) * 100 : 0;
      this.logger.warn(
        `[Circuit Breaker] "${serviceName}" state transitioned to OPEN. Total requests: ${total}, Failure rate: ${failPercent.toFixed(1)}%`,
      );
    });

    breaker.on('close', () => {
      this.logger.log(`[Circuit Breaker] "${serviceName}" state transitioned to CLOSED (Healthy).`);
    });

    breaker.on('halfOpen', () => {
      this.logger.log(`[Circuit Breaker] "${serviceName}" state transitioned to HALF_OPEN. Probing...`);
    });

    // Logging hooks for errors and latency during execution
    breaker.on('failure', (err: any, latencyMs: number) => {
      this.logger.error(
        `[Circuit Breaker] "${serviceName}" execution failed in ${latencyMs}ms. Error: ${err?.message || err}`,
      );
    });

    breaker.on('timeout', (err: any) => {
      this.logger.warn(`[Circuit Breaker] "${serviceName}" execution timed out.`);
    });

    breaker.on('reject', () => {
      this.logger.warn(`[Circuit Breaker] "${serviceName}" execution REJECTED: circuit is currently OPEN.`);
    });

    breaker.on('fallback', (result: any, err: any) => {
      const errMsg = err?.message || err || 'execution failure';
      this.logger.warn(`[Circuit Breaker] "${serviceName}" fallback executed due to: ${errMsg}`);
    });

    this.breakers.set(serviceName, breaker);
    return breaker;
  }

  /**
   * Get an eagerly registered breaker instance. Creates one dynamically for testing/custom services.
   */
  getBreaker(serviceName: string, customOptions?: Opossum.Options): Opossum<[() => Promise<any>], any> {
    if (!this.breakers.has(serviceName)) {
      this.registerBreaker(serviceName, customOptions);
    }
    return this.breakers.get(serviceName)!;
  }

  /**
   * Execute an action wrapped inside a circuit breaker.
   */
  async execute<T>(
    serviceName: string,
    action: () => Promise<T>,
    options?: Opossum.Options,
    fallback?: (err: any) => T | Promise<T>,
  ): Promise<T> {
    const breaker = this.getBreaker(serviceName, options);
    if (fallback) {
      breaker.fallback((...args: any[]) => {
        const error = args.find(a => a instanceof Error);
        return fallback(error || args[0]);
      });
    }
    return breaker.fire(action) as Promise<T>;
  }

  /**
   * Returns a detailed health diagnostic snapshot of all registered breakers.
   */
  getHealth(): BreakerHealthInfo[] {
    const diagnostics: BreakerHealthInfo[] = [];

    for (const [name, breaker] of this.breakers.entries()) {
      let state = 'CLOSED';
      if (breaker.opened) {
        state = 'OPEN';
      } else if (breaker.halfOpen) {
        state = 'HALF_OPEN';
      }

      diagnostics.push({
        service: name,
        state,
        stats: breaker.stats,
        options: (breaker as any).options,
      });
    }

    return diagnostics;
  }
}
