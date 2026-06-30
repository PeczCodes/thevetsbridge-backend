import { Logger } from '@nestjs/common';

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerOptions {
  failureThreshold?: number; // default: 5 failures
  cooldownPeriodMs?: number; // default: 10,000ms
  requestTimeoutMs?: number; // default: 5,000ms
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private consecutiveFailures = 0;
  private lastFailureTime = 0;
  private readonly logger = new Logger(CircuitBreaker.name);

  private readonly failureThreshold: number;
  private readonly cooldownPeriodMs: number;
  private readonly requestTimeoutMs: number;

  constructor(
    private readonly serviceName: string,
    options: CircuitBreakerOptions = {},
  ) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.cooldownPeriodMs = options.cooldownPeriodMs ?? 10000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 5000;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.updateState();

    if (this.state === CircuitState.OPEN) {
      this.logger.warn(`Circuit is OPEN for service "${this.serviceName}". Request blocked.`);
      throw new Error(`Circuit breaker triggered: service "${this.serviceName}" is unavailable.`);
    }

    try {
      const result = await this.runWithTimeout(fn);
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err);
      throw err;
    }
  }

  private updateState() {
    if (this.state === CircuitState.OPEN && Date.now() - this.lastFailureTime > this.cooldownPeriodMs) {
      this.state = CircuitState.HALF_OPEN;
      this.logger.log(`Circuit for service "${this.serviceName}" transitioned to HALF-OPEN. Probing...`);
    }
  }

  private onSuccess() {
    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.CLOSED;
      this.consecutiveFailures = 0;
      this.logger.log(`Circuit for service "${this.serviceName}" transitioned to CLOSED (Healthy).`);
    } else if (this.state === CircuitState.CLOSED) {
      this.consecutiveFailures = 0;
    }
  }

  private onFailure(err: any) {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();
    this.logger.error(
      `Service "${this.serviceName}" call failed (${this.consecutiveFailures}/${this.failureThreshold}). Error: ${err.message || err}`,
    );

    if (this.state === CircuitState.CLOSED && this.consecutiveFailures >= this.failureThreshold) {
      this.state = CircuitState.OPEN;
      this.logger.warn(`Circuit for service "${this.serviceName}" has TRIPPED (OPEN). Rejecting further calls.`);
    } else if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN;
      this.logger.warn(`Circuit probe failed for service "${this.serviceName}". Kept OPEN.`);
    }
  }

  private runWithTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout: service "${this.serviceName}" took longer than ${this.requestTimeoutMs}ms to respond.`));
      }, this.requestTimeoutMs);

      fn()
        .then((res) => {
          clearTimeout(timer);
          resolve(res);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  getState(): CircuitState {
    return this.state;
  }
}
