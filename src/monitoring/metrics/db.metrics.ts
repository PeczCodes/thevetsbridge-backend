import {
  makeCounterProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';

export const DB_QUERY_DURATION_SECONDS = 'db_query_duration_seconds';
export const DB_QUERY_FAILURES_TOTAL = 'db_query_failures_total';

export const dbMetricsProviders = [
  makeHistogramProvider({
    name: DB_QUERY_DURATION_SECONDS,
    help: 'Duration of database query executions in seconds',
    labelNames: ['model', 'action'],
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  }),
  makeCounterProvider({
    name: DB_QUERY_FAILURES_TOTAL,
    help: 'Total number of failed database queries',
    labelNames: ['model', 'action'],
  }),
];
