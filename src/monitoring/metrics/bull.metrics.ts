import {
  makeCounterProvider,
  makeGaugeProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';

export const BULLMQ_JOBS_COMPLETED_TOTAL = 'bullmq_jobs_completed_total';
export const BULLMQ_JOBS_FAILED_TOTAL = 'bullmq_jobs_failed_total';
export const BULLMQ_JOBS_RETRIED_TOTAL = 'bullmq_jobs_retried_total';
export const BULLMQ_JOBS_DELAYED_TOTAL = 'bullmq_jobs_delayed_total';
export const BULLMQ_JOBS_STALLED_TOTAL = 'bullmq_jobs_stalled_total';
export const BULLMQ_JOB_DURATION_SECONDS = 'bullmq_job_duration_seconds';
export const BULLMQ_JOBS_ACTIVE = 'bullmq_jobs_active';
export const BULLMQ_JOBS_WAITING = 'bullmq_jobs_waiting';
export const BULLMQ_JOBS_DELAYED = 'bullmq_jobs_delayed';
export const BULLMQ_JOBS_COMPLETED = 'bullmq_jobs_completed';
export const BULLMQ_JOBS_FAILED = 'bullmq_jobs_failed';

// Backwards compatibility aliases
export const BULL_JOBS_COMPLETED_TOTAL = BULLMQ_JOBS_COMPLETED_TOTAL;
export const BULL_JOBS_FAILED_TOTAL = BULLMQ_JOBS_FAILED_TOTAL;
export const BULL_JOBS_RETRIED_TOTAL = BULLMQ_JOBS_RETRIED_TOTAL;
export const BULL_QUEUE_DURATION_SECONDS = BULLMQ_JOB_DURATION_SECONDS;
export const BULL_ACTIVE_JOBS = BULLMQ_JOBS_ACTIVE;
export const BULL_WAITING_JOBS = BULLMQ_JOBS_WAITING;

export const bullMetricsProviders = [
  makeCounterProvider({
    name: BULLMQ_JOBS_COMPLETED_TOTAL,
    help: 'Total number of completed BullMQ background jobs',
    labelNames: ['queue', 'job_name'],
  }),
  makeCounterProvider({
    name: BULLMQ_JOBS_FAILED_TOTAL,
    help: 'Total number of failed BullMQ background jobs',
    labelNames: ['queue', 'job_name', 'error_type'],
  }),
  makeCounterProvider({
    name: BULLMQ_JOBS_RETRIED_TOTAL,
    help: 'Total number of retried BullMQ background jobs',
    labelNames: ['queue', 'job_name'],
  }),
  makeCounterProvider({
    name: BULLMQ_JOBS_DELAYED_TOTAL,
    help: 'Total number of delayed BullMQ background jobs',
    labelNames: ['queue', 'job_name'],
  }),
  makeCounterProvider({
    name: BULLMQ_JOBS_STALLED_TOTAL,
    help: 'Total number of stalled BullMQ background jobs',
    labelNames: ['queue', 'job_name'],
  }),
  makeHistogramProvider({
    name: BULLMQ_JOB_DURATION_SECONDS,
    help: 'Duration of BullMQ background job processing in seconds',
    labelNames: ['queue', 'job_name'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  }),
  makeGaugeProvider({
    name: BULLMQ_JOBS_ACTIVE,
    help: 'Current count of active BullMQ jobs in queue',
    labelNames: ['queue'],
  }),
  makeGaugeProvider({
    name: BULLMQ_JOBS_WAITING,
    help: 'Current count of waiting BullMQ jobs in queue',
    labelNames: ['queue'],
  }),
  makeGaugeProvider({
    name: BULLMQ_JOBS_DELAYED,
    help: 'Current count of delayed BullMQ jobs in queue',
    labelNames: ['queue'],
  }),
  makeGaugeProvider({
    name: BULLMQ_JOBS_COMPLETED,
    help: 'Current count of completed BullMQ jobs in queue',
    labelNames: ['queue'],
  }),
  makeGaugeProvider({
    name: BULLMQ_JOBS_FAILED,
    help: 'Current count of failed BullMQ jobs in queue',
    labelNames: ['queue'],
  }),
];
