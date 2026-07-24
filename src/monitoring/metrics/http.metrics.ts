import {
  makeCounterProvider,
  makeGaugeProvider,
  makeHistogramProvider,
  makeSummaryProvider,
} from '@willsoto/nestjs-prometheus';

export const HTTP_REQUESTS_TOTAL = 'http_requests_total';
export const HTTP_REQUEST_DURATION_SECONDS = 'http_request_duration_seconds';
export const HTTP_RESPONSE_DURATION_SUMMARY = 'http_response_duration_summary';
export const HTTP_REQUESTS_IN_FLIGHT = 'http_requests_in_flight';
export const HTTP_REQUEST_SIZE_BYTES = 'http_request_size_bytes';
export const HTTP_RESPONSE_SIZE_BYTES = 'http_response_size_bytes';

export const httpMetricsProviders = [
  makeCounterProvider({
    name: HTTP_REQUESTS_TOTAL,
    help: 'Total number of HTTP requests processed',
    labelNames: ['method', 'route', 'status_code'],
  }),
  makeHistogramProvider({
    name: HTTP_REQUEST_DURATION_SECONDS,
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  }),
  makeSummaryProvider({
    name: HTTP_RESPONSE_DURATION_SUMMARY,
    help: 'Response duration summary percentiles (P50, P90, P95, P99)',
    labelNames: ['method', 'route'],
    percentiles: [0.5, 0.9, 0.95, 0.99],
  }),
  makeGaugeProvider({
    name: HTTP_REQUESTS_IN_FLIGHT,
    help: 'Current number of in-flight HTTP requests being processed',
    labelNames: ['method', 'route'],
  }),
  makeHistogramProvider({
    name: HTTP_REQUEST_SIZE_BYTES,
    help: 'HTTP request payload size in bytes',
    labelNames: ['method', 'route'],
    buckets: [100, 1000, 10000, 100000, 1000000, 5000000],
  }),
  makeHistogramProvider({
    name: HTTP_RESPONSE_SIZE_BYTES,
    help: 'HTTP response payload size in bytes',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [100, 1000, 10000, 100000, 1000000, 5000000],
  }),
];
