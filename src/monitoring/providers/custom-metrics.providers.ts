import { authMetricsProviders } from '../metrics/auth.metrics';
import { cacheMetricsProviders } from '../metrics/cache.metrics';
import { bullMetricsProviders } from '../metrics/bull.metrics';
import { dbMetricsProviders } from '../metrics/db.metrics';
import { httpMetricsProviders } from '../metrics/http.metrics';
import { healthMetricsProviders } from '../metrics/health.metrics';
import { businessMetricsProviders } from '../metrics/business.metrics';

export const allCustomMetricsProviders = [
  ...authMetricsProviders,
  ...cacheMetricsProviders,
  ...bullMetricsProviders,
  ...dbMetricsProviders,
  ...httpMetricsProviders,
  ...healthMetricsProviders,
  ...businessMetricsProviders,
];
