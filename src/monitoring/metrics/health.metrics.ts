import {
  makeCounterProvider,
  makeGaugeProvider,
} from '@willsoto/nestjs-prometheus';

export const APP_INFO = 'app_info';
export const APP_UPTIME_SECONDS = 'app_uptime_seconds';
export const EXCEPTIONS_TOTAL = 'exceptions_total';

export const healthMetricsProviders = [
  makeGaugeProvider({
    name: APP_INFO,
    help: 'Static metadata info regarding application build and environment',
    labelNames: ['version', 'environment', 'node_version'],
  }),
  makeGaugeProvider({
    name: APP_UPTIME_SECONDS,
    help: 'Application uptime in seconds',
  }),
  makeCounterProvider({
    name: EXCEPTIONS_TOTAL,
    help: 'Total unhandled and handled exception occurrences',
    labelNames: ['exception_type', 'status_code', 'is_handled', 'category'],
  }),
];
