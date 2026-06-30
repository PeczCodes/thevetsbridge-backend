import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../core/prisma/prisma.service';
import { REDIS_CLIENT } from '../core/redis/redis.module';
import Redis from 'ioredis';

const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0];

@Injectable()
export class MetricsService {
  private httpRequestsTotal = new Map<string, number>();
  private httpRequestDurationSum = new Map<string, number>();
  private httpRequestDurationCount = new Map<string, number>();
  private httpRequestDurationBuckets = new Map<string, Map<number, number>>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  recordRequest(method: string, path: string, status: string, durationSeconds: number) {
    const key = `${method}:${path}:${status}`;

    // Increments total requests
    const total = this.httpRequestsTotal.get(key) || 0;
    this.httpRequestsTotal.set(key, total + 1);

    // Sum duration
    const sum = this.httpRequestDurationSum.get(key) || 0;
    this.httpRequestDurationSum.set(key, sum + durationSeconds);

    // Count duration
    const count = this.httpRequestDurationCount.get(key) || 0;
    this.httpRequestDurationCount.set(key, count + 1);

    // Buckets
    let bucketsMap = this.httpRequestDurationBuckets.get(key);
    if (!bucketsMap) {
      const newMap = new Map<number, number>();
      BUCKETS.forEach(b => newMap.set(b, 0));
      this.httpRequestDurationBuckets.set(key, newMap);
      bucketsMap = newMap;
    }

    const activeMap = bucketsMap;
    BUCKETS.forEach(bucket => {
      if (durationSeconds <= bucket) {
        const currentVal = activeMap.get(bucket) || 0;
        activeMap.set(bucket, currentVal + 1);
      }
    });
  }

  async getHealthStatus() {
    let dbStatus = 'up';
    let redisStatus = 'up';
    let dbLatencyMs = -1;
    let redisLatencyMs = -1;

    // Test DB
    try {
      const start = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      dbLatencyMs = Date.now() - start;
    } catch (err) {
      dbStatus = `down: ${err.message || err}`;
    }

    // Test Redis
    try {
      const start = Date.now();
      await this.redis.ping();
      redisLatencyMs = Date.now() - start;
    } catch (err) {
      redisStatus = `down: ${err.message || err}`;
    }

    const memoryUsage = process.memoryUsage();

    return {
      status: dbStatus === 'up' && redisStatus === 'up' ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      components: {
        database: {
          status: dbStatus,
          latencyMs: dbLatencyMs,
        },
        redis: {
          status: redisStatus,
          latencyMs: redisLatencyMs,
        },
      },
      system: {
        memory: {
          rssMb: Math.round(memoryUsage.rss / 1024 / 1024 * 100) / 100,
          heapTotalMb: Math.round(memoryUsage.heapTotal / 1024 / 1024 * 100) / 100,
          heapUsedMb: Math.round(memoryUsage.heapUsed / 1024 / 1024 * 100) / 100,
        },
      },
    };
  }

  async getMetricsAsText(): Promise<string> {
    const memory = process.memoryUsage();
    const uptime = process.uptime();

    // Check components
    let dbUp = 1;
    let dbLatencySec = 0;
    try {
      const start = process.hrtime();
      await this.prisma.$queryRaw`SELECT 1`;
      const diff = process.hrtime(start);
      dbLatencySec = diff[0] + diff[1] / 1e9;
    } catch (err) {
      dbUp = 0;
    }

    let redisUp = 1;
    let redisLatencySec = 0;
    try {
      const start = process.hrtime();
      await this.redis.ping();
      const diff = process.hrtime(start);
      redisLatencySec = diff[0] + diff[1] / 1e9;
    } catch (err) {
      redisUp = 0;
    }

    let lines: string[] = [];

    // App Metadata
    lines.push('# HELP app_info Info metadata about the application.');
    lines.push('# TYPE app_info gauge');
    lines.push(`app_info{version="1.0.0"} 1`);

    // System metrics
    lines.push('# HELP process_uptime_seconds Process uptime in seconds.');
    lines.push('# TYPE process_uptime_seconds gauge');
    lines.push(`process_uptime_seconds ${uptime}`);

    lines.push('# HELP process_memory_rss_bytes Resident Set Size (RSS) memory in bytes.');
    lines.push('# TYPE process_memory_rss_bytes gauge');
    lines.push(`process_memory_rss_bytes ${memory.rss}`);

    lines.push('# HELP process_memory_heap_total_bytes Total heap memory size in bytes.');
    lines.push('# TYPE process_memory_heap_total_bytes gauge');
    lines.push(`process_memory_heap_total_bytes ${memory.heapTotal}`);

    lines.push('# HELP process_memory_heap_used_bytes Used heap memory size in bytes.');
    lines.push('# TYPE process_memory_heap_used_bytes gauge');
    lines.push(`process_memory_heap_used_bytes ${memory.heapUsed}`);

    // DB & Redis metrics
    lines.push('# HELP health_db_status Health status of the primary database (1 = up, 0 = down).');
    lines.push('# TYPE health_db_status gauge');
    lines.push(`health_db_status ${dbUp}`);

    lines.push('# HELP health_db_latency_seconds Latency of database connectivity query in seconds.');
    lines.push('# TYPE health_db_latency_seconds gauge');
    lines.push(`health_db_latency_seconds ${dbLatencySec}`);

    lines.push('# HELP health_redis_status Health status of the Redis instance (1 = up, 0 = down).');
    lines.push('# TYPE health_redis_status gauge');
    lines.push(`health_redis_status ${redisUp}`);

    lines.push('# HELP health_redis_latency_seconds Latency of Redis ping connectivity check in seconds.');
    lines.push('# TYPE health_redis_latency_seconds gauge');
    lines.push(`health_redis_latency_seconds ${redisLatencySec}`);

    // HTTP Total request count
    lines.push('# HELP http_requests_total Total number of HTTP requests processed.');
    lines.push('# TYPE http_requests_total counter');
    this.httpRequestsTotal.forEach((value, key) => {
      const [method, path, status] = key.split(':');
      lines.push(`http_requests_total{method="${method}",path="${path}",status="${status}"} ${value}`);
    });

    // HTTP duration buckets
    lines.push('# HELP http_request_duration_seconds HTTP request execution time in seconds (buckets).');
    lines.push('# TYPE http_request_duration_seconds histogram');
    
    // We output buckets + sum + count for each key
    const allKeys = Array.from(this.httpRequestDurationCount.keys());
    for (const key of allKeys) {
      const [method, path, status] = key.split(':');
      const bucketsMap = this.httpRequestDurationBuckets.get(key);
      const totalCount = this.httpRequestDurationCount.get(key) || 0;
      const totalSum = this.httpRequestDurationSum.get(key) || 0;

      if (bucketsMap) {
        BUCKETS.forEach(bucket => {
          const count = bucketsMap.get(bucket) || 0;
          lines.push(`http_request_duration_seconds_bucket{method="${method}",path="${path}",status="${status}",le="${bucket}"} ${count}`);
        });
        // +Inf bucket equals the totalCount
        lines.push(`http_request_duration_seconds_bucket{method="${method}",path="${path}",status="${status}",le="+Inf"} ${totalCount}`);
      }

      lines.push(`http_request_duration_seconds_sum{method="${method}",path="${path}",status="${status}"} ${totalSum}`);
      lines.push(`http_request_duration_seconds_count{method="${method}",path="${path}",status="${status}"} ${totalCount}`);
    }

    return lines.join('\n') + '\n';
  }
}
