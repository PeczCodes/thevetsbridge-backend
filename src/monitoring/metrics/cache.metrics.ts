import { makeCounterProvider, makeGaugeProvider } from '@willsoto/nestjs-prometheus';

export const REDIS_CACHE_HITS_TOTAL = 'redis_cache_hits_total';
export const REDIS_CACHE_MISSES_TOTAL = 'redis_cache_misses_total';
export const REDIS_CACHE_WRITES_TOTAL = 'redis_cache_writes_total';
export const REDIS_CACHE_DELETIONS_TOTAL = 'redis_cache_deletions_total';
export const REDIS_CACHE_INVALIDATIONS_TOTAL = 'redis_cache_invalidations_total';
export const REDIS_CACHE_ERRORS_TOTAL = 'redis_cache_errors_total';
export const REDIS_CONNECTED_CLIENTS = 'redis_connected_clients';
export const REDIS_USED_MEMORY_BYTES = 'redis_used_memory_bytes';

// Backwards compatibility aliases
export const CACHE_HITS_TOTAL = REDIS_CACHE_HITS_TOTAL;
export const CACHE_MISSES_TOTAL = REDIS_CACHE_MISSES_TOTAL;
export const CACHE_WRITES_TOTAL = REDIS_CACHE_WRITES_TOTAL;
export const CACHE_INVALIDATIONS_TOTAL = REDIS_CACHE_INVALIDATIONS_TOTAL;
export const REDIS_CONNECTION_FAILURES_TOTAL = REDIS_CACHE_ERRORS_TOTAL;

export const cacheMetricsProviders = [
  makeCounterProvider({
    name: REDIS_CACHE_HITS_TOTAL,
    help: 'Total number of Redis cache hits',
    labelNames: ['namespace'],
  }),
  makeCounterProvider({
    name: REDIS_CACHE_MISSES_TOTAL,
    help: 'Total number of Redis cache misses',
    labelNames: ['namespace'],
  }),
  makeCounterProvider({
    name: REDIS_CACHE_WRITES_TOTAL,
    help: 'Total number of Redis cache write operations',
    labelNames: ['operation'],
  }),
  makeCounterProvider({
    name: REDIS_CACHE_DELETIONS_TOTAL,
    help: 'Total number of Redis cache explicit key deletions',
    labelNames: ['namespace'],
  }),
  makeCounterProvider({
    name: REDIS_CACHE_INVALIDATIONS_TOTAL,
    help: 'Total number of Redis cache key invalidations',
    labelNames: ['namespace'],
  }),
  makeCounterProvider({
    name: REDIS_CACHE_ERRORS_TOTAL,
    help: 'Total number of Redis connection/operation error events',
    labelNames: ['event'],
  }),
  makeGaugeProvider({
    name: REDIS_CONNECTED_CLIENTS,
    help: 'Number of connected clients to Redis instance',
  }),
  makeGaugeProvider({
    name: REDIS_USED_MEMORY_BYTES,
    help: 'Total memory allocated by Redis in bytes',
  }),
];
