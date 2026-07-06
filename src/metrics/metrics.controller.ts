import { Controller, Get, Res, HttpStatus } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { Public } from '../modules/identity/auth/decorators/public.decorator';
import * as express from 'express';
import { CircuitBreakerService } from '../../infra/circuit-breaker/circuit-breaker.service';

@Controller()
export class MetricsController {
  constructor(
    private readonly metricsService: MetricsService,
    private readonly circuitBreakerService: CircuitBreakerService,
  ) {}

  @Public()
  @Get('health')
  async getHealth() {
    return this.metricsService.getHealthStatus();
  }

  @Public()
  @Get('health/dependencies')
  async getDependenciesHealth() {
    const diagnostics = this.circuitBreakerService.getHealth();
    const result: Record<string, any> = {};
    for (const d of diagnostics) {
      const total = d.stats.successes + d.stats.failures;
      const successRate =
        total > 0
          ? Math.round((d.stats.successes / total) * 100 * 10) / 10
          : 100;
      result[d.service] = {
        state: d.state,
        successRate,
        latencyMean: d.stats.latencyMean,
        failures: d.stats.failures,
        successes: d.stats.successes,
        timeouts: d.stats.timeouts,
        rejects: d.stats.rejects,
      };
    }
    return result;
  }

  @Public()
  @Get('metrics')
  async getMetrics(@Res() res: express.Response) {
    const metricsText = await this.metricsService.getMetricsAsText();
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    return res.status(HttpStatus.OK).send(metricsText);
  }
}
