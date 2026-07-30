import { registerAs } from '@nestjs/config';

export interface MetricsConfig {
  enabled: boolean;
  authEnabled: boolean;
  apiKey: string;
  grafanaCloud: {
    prometheusUrl: string;
    user: string;
    apiKey: string;
  };
}

export const metricsConfig = registerAs('metrics', (): MetricsConfig => ({
  enabled: process.env.METRICS_ENABLED !== 'false',
  authEnabled: process.env.METRICS_AUTH_ENABLED === 'true',
  apiKey: process.env.METRICS_API_KEY || '',
  grafanaCloud: {
    prometheusUrl: process.env.GRAFANA_CLOUD_PROMETHEUS_URL || '',
    user: process.env.GRAFANA_CLOUD_PROMETHEUS_USER || '',
    apiKey: process.env.GRAFANA_CLOUD_API_KEY || '',
  },
}));
