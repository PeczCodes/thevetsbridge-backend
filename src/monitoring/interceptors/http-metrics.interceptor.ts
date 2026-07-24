import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { finalize, tap } from 'rxjs/operators';
import { MonitoringService } from '../monitoring.service';
import {
  HTTP_REQUESTS_TOTAL,
  HTTP_REQUEST_DURATION_SECONDS,
  HTTP_RESPONSE_DURATION_SUMMARY,
  HTTP_REQUESTS_IN_FLIGHT,
  HTTP_REQUEST_SIZE_BYTES,
  HTTP_RESPONSE_SIZE_BYTES,
} from '../metrics/http.metrics';

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  private readonly excludedRoutes = [
    '/metrics',
    '/v1/metrics',
    '/health',
    '/v1/health',
    '/favicon.ico',
  ];

  constructor(private readonly monitoringService: MonitoringService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();

    const rawPath = req.originalUrl || req.url || '';
    if (this.isExcluded(rawPath)) {
      return next.handle();
    }

    const startTime = process.hrtime();
    const method = (req.method || 'GET').toUpperCase();
    const route = this.normalizeRoute(req);

    // Track In-Flight Request
    this.monitoringService.incrementGauge(HTTP_REQUESTS_IN_FLIGHT, 1, { method, route });

    // Measure Request Payload Size
    const reqLength = req.headers['content-length'];
    if (reqLength) {
      const bytes = parseInt(reqLength, 10);
      if (!isNaN(bytes)) {
        this.monitoringService.observeHistogram(HTTP_REQUEST_SIZE_BYTES, bytes, { method, route });
      }
    }

    return next.handle().pipe(
      tap({
        next: () => this.recordMetrics(req, res, method, route, startTime),
        error: () => this.recordMetrics(req, res, method, route, startTime),
      }),
      finalize(() => {
        // Decrement In-Flight Request Gauge
        this.monitoringService.decrementGauge(HTTP_REQUESTS_IN_FLIGHT, 1, { method, route });
      }),
    );
  }

  private recordMetrics(
    req: any,
    res: any,
    method: string,
    route: string,
    startTime: [number, number],
  ) {
    const diff = process.hrtime(startTime);
    const durationInSeconds = diff[0] + diff[1] / 1e9;
    const statusCode = String(res.statusCode || 500);

    const labels = {
      method,
      route,
      status_code: statusCode,
    };

    // Increment request total counter
    this.monitoringService.incrementCounter(HTTP_REQUESTS_TOTAL, 1, labels);

    // Observe duration histogram
    this.monitoringService.observeHistogram(HTTP_REQUEST_DURATION_SECONDS, durationInSeconds, labels);

    // Observe duration summary for percentiles
    this.monitoringService.observeSummary(HTTP_RESPONSE_DURATION_SUMMARY, durationInSeconds, {
      method,
      route,
    });

    // Measure Response Payload Size
    const resLength = res.getHeader('content-length');
    if (resLength) {
      const bytes = parseInt(String(resLength), 10);
      if (!isNaN(bytes)) {
        this.monitoringService.observeHistogram(HTTP_RESPONSE_SIZE_BYTES, bytes, labels);
      }
    }
  }

  private isExcluded(path: string): boolean {
    return this.excludedRoutes.some((excluded) => path.startsWith(excluded));
  }

  private normalizeRoute(req: any): string {
    if (req.route?.path) {
      const prefix = req.baseUrl || '';
      return `${prefix}${req.route.path}`;
    }

    let urlPath = (req.originalUrl || req.url || '/').split('?')[0];

    // Normalize CUIDs, UUIDs, MongoDB IDs, and integers to prevent high cardinality
    urlPath = urlPath
      .replace(/\/[a-z0-9]{24,32}(?=\/|$)/gi, '/:id') // CUIDs / ObjectIds
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:id') // UUIDs
      .replace(/\/\d+(?=\/|$)/g, '/:id'); // Integers

    return urlPath || 'unknown';
  }
}
