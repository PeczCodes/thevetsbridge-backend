import { Controller, Get, Res, HttpStatus } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { Public } from '../modules/identity/auth/decorators/public.decorator';
import * as express from 'express';

@Controller()
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Public()
  @Get('health')
  async getHealth() {
    return this.metricsService.getHealthStatus();
  }

  @Public()
  @Get('metrics')
  async getMetrics(@Res() res: express.Response) {
    const metricsText = await this.metricsService.getMetricsAsText();
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    return res.status(HttpStatus.OK).send(metricsText);
  }
}
