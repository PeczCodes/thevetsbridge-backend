import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metricsService: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const rawPath = req.baseUrl || req.path;
    
    if (rawPath.includes('/metrics') || rawPath.includes('/health')) {
      return next();
    }

    const start = process.hrtime();

    res.on('finish', () => {
      const diff = process.hrtime(start);
      const durationSeconds = diff[0] + diff[1] / 1e9;
      
      const { method } = req;
      const path = this.normalizePath(rawPath);
      const status = String(res.statusCode);

      this.metricsService.recordRequest(method, path, status, durationSeconds);
    });

    next();
  }

  private normalizePath(path: string): string {
    if (!path) return '/';

    // Remove query params if any
    let normalized = path.split('?')[0];

    // Replace UUIDs (e.g. 550e8400-e29b-41d4-a716-446655440000)
    normalized = normalized.replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, ':id');

    // Replace numeric IDs (e.g. /users/123 -> /users/:id)
    normalized = normalized.replace(/\/\d+/g, '/:id');

    // Replace Mongo IDs or other 24-character hex strings if used
    normalized = normalized.replace(/\/[0-9a-fA-F]{24}/g, '/:id');

    return normalized;
  }
}
