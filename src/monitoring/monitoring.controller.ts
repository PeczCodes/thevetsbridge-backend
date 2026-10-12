import {
  Controller,
  Get,
  Res,
  UseGuards,
  Version,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { register } from 'prom-client';
import { MetricsAuthGuard } from './guards/metrics-auth.guard';
import { SkipThrottle } from '@nestjs/throttler';

@ApiTags('Monitoring')
@Controller()
@SkipThrottle()
export class MonitoringController {
  @Get('metrics')
  @Version([VERSION_NEUTRAL, '1'])
  @UseGuards(MetricsAuthGuard)
  @ApiExcludeEndpoint()
  async getMetrics(@Res() res: Response) {
    res.setHeader('Content-Type', register.contentType);
    res.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate',
    );
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    const metricsStr = await register.metrics();
    return res.send(metricsStr);
  }
}
