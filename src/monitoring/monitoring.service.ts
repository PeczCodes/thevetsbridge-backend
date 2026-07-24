import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Counter, Gauge, Histogram, Summary, collectDefaultMetrics, register } from 'prom-client';
import { APP_INFO, APP_UPTIME_SECONDS } from './metrics/health.metrics';

@Injectable()
export class MonitoringService implements OnModuleInit {
  private readonly logger = new Logger(MonitoringService.name);

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.initializeDefaultMetrics();
    this.recordAppInfo();
    this.startUptimeGauge();
  }

  private initializeDefaultMetrics() {
    try {
      collectDefaultMetrics({
        register,
        eventLoopMonitoringPrecision: 10,
      });
      this.logger.log('Prometheus default Node.js runtime metrics initialized.');
    } catch (err: any) {
      this.logger.debug(`Default metrics collection status: ${err.message}`);
    }
  }

  private recordAppInfo() {
    const version = process.env.npm_package_version || '1.0.0';
    const env = this.configService.get<string>('app.env') || process.env.NODE_ENV || 'development';
    const nodeVersion = process.version;

    this.setGauge(APP_INFO, 1, {
      version,
      environment: env,
      node_version: nodeVersion,
    });
  }

  private startUptimeGauge() {
    const startTime = Date.now();
    setInterval(() => {
      const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
      this.setGauge(APP_UPTIME_SECONDS, uptimeSeconds);
    }, 15000);
  }

  /**
   * Increments a Counter metric by value (default 1).
   */
  incrementCounter(name: string, value = 1, labels: Record<string, string | number> = {}) {
    try {
      const metric = register.getSingleMetric(name);
      if (metric && metric instanceof Counter) {
        const cleanLabels = this.stringifyLabels(labels);
        metric.inc(cleanLabels, value);
      } else {
        this.logger.warn(`Metric counter '${name}' not registered or invalid type.`);
      }
    } catch (err: any) {
      this.logger.error(`Error incrementing counter '${name}': ${err?.message}`);
    }
  }

  /**
   * Sets a Gauge metric to a specified value.
   */
  setGauge(name: string, value: number, labels: Record<string, string | number> = {}) {
    try {
      const metric = register.getSingleMetric(name);
      if (metric && metric instanceof Gauge) {
        const cleanLabels = this.stringifyLabels(labels);
        metric.set(cleanLabels, value);
      } else {
        this.logger.warn(`Metric gauge '${name}' not registered or invalid type.`);
      }
    } catch (err: any) {
      this.logger.error(`Error setting gauge '${name}': ${err?.message}`);
    }
  }

  /**
   * Increments a Gauge metric by value (default 1).
   */
  incrementGauge(name: string, value = 1, labels: Record<string, string | number> = {}) {
    try {
      const metric = register.getSingleMetric(name);
      if (metric && metric instanceof Gauge) {
        const cleanLabels = this.stringifyLabels(labels);
        metric.inc(cleanLabels, value);
      } else {
        this.logger.warn(`Metric gauge '${name}' not registered or invalid type.`);
      }
    } catch (err: any) {
      this.logger.error(`Error incrementing gauge '${name}': ${err?.message}`);
    }
  }

  /**
   * Decrements a Gauge metric by value (default 1).
   */
  decrementGauge(name: string, value = 1, labels: Record<string, string | number> = {}) {
    try {
      const metric = register.getSingleMetric(name);
      if (metric && metric instanceof Gauge) {
        const cleanLabels = this.stringifyLabels(labels);
        metric.dec(cleanLabels, value);
      } else {
        this.logger.warn(`Metric gauge '${name}' not registered or invalid type.`);
      }
    } catch (err: any) {
      this.logger.error(`Error decrementing gauge '${name}': ${err?.message}`);
    }
  }

  /**
   * Observes a value in a Histogram metric.
   */
  observeHistogram(name: string, value: number, labels: Record<string, string | number> = {}) {
    try {
      const metric = register.getSingleMetric(name);
      if (metric && metric instanceof Histogram) {
        const cleanLabels = this.stringifyLabels(labels);
        metric.observe(cleanLabels, value);
      } else {
        this.logger.warn(`Metric histogram '${name}' not registered or invalid type.`);
      }
    } catch (err: any) {
      this.logger.error(`Error observing histogram '${name}': ${err?.message}`);
    }
  }

  /**
   * Observes a value in a Summary metric.
   */
  observeSummary(name: string, value: number, labels: Record<string, string | number> = {}) {
    try {
      const metric = register.getSingleMetric(name);
      if (metric && metric instanceof Summary) {
        const cleanLabels = this.stringifyLabels(labels);
        metric.observe(cleanLabels, value);
      } else {
        this.logger.warn(`Metric summary '${name}' not registered or invalid type.`);
      }
    } catch (err: any) {
      this.logger.error(`Error observing summary '${name}': ${err?.message}`);
    }
  }

  private stringifyLabels(labels: Record<string, string | number>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, val] of Object.entries(labels)) {
      result[key] = String(val);
    }
    return result;
  }
}
