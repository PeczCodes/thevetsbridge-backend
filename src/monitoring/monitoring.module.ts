import { Global, Module } from '@nestjs/common';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { MonitoringService } from './monitoring.service';
import { allCustomMetricsProviders } from './providers/custom-metrics.providers';
import { HttpMetricsInterceptor } from './interceptors/http-metrics.interceptor';
import { ExceptionMonitoringFilter } from './interceptors/exception-monitoring.filter';
import { MetricsAuthGuard } from './guards/metrics-auth.guard';

@Global()
@Module({
  imports: [
    PrometheusModule.register({
      defaultMetrics: {
        enabled: true,
        config: {
          prefix: '',
        },
      },
      // Use an internal path to prevent the default PrometheusController from
      // conflicting with our MetricsController at /v1/metrics
      path: '/internal/prometheus-raw',
    }),
  ],
  controllers: [],
  providers: [
    MonitoringService,
    MetricsAuthGuard,
    HttpMetricsInterceptor,
    ExceptionMonitoringFilter,
    ...allCustomMetricsProviders,
  ],
  exports: [
    MonitoringService,
    MetricsAuthGuard,
    HttpMetricsInterceptor,
    ExceptionMonitoringFilter,
    ...allCustomMetricsProviders,
  ],
})
export class MonitoringModule {}
