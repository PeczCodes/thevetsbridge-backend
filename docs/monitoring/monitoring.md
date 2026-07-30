# Monitoring & Observability

## Purpose

The monitoring subsystem collects real-time operational metrics across HTTP controllers, database queries, Redis operations, and BullMQ queues, exposing Prometheus-formatted metrics at `/metrics` and health checks at `/v1/health`.

---

## Participating Modules & Files

* **Service**: `src/monitoring/monitoring.service.ts`
* **Interceptors & Filters**:
  - `src/monitoring/interceptors/http-metrics.interceptor.ts`
  - `src/monitoring/interceptors/exception-monitoring.filter.ts`
* **Metric Collections**:
  - `src/monitoring/metrics/http.metrics.ts`
  - `src/monitoring/metrics/bull.metrics.ts`
  - `src/monitoring/metrics/redis.metrics.ts`
  - `src/monitoring/metrics/business.metrics.ts`
  - `src/monitoring/metrics/health.metrics.ts`

---

## Exposed Prometheus Metrics

| Metric Name | Type | Description |
| :--- | :--- | :--- |
| `http_requests_total` | Counter | Total HTTP requests categorized by `method`, `route`, and `status_code`. |
| `http_request_duration_seconds` | Histogram | Request duration distribution. |
| `bull_jobs_total` | Counter | Queue jobs categorized by `queue` and `status` (`completed`/`failed`). |
| `redis_operations_total` | Counter | Cache queries categorized by `operation` and `status`. |
| `emails_sent_total` | Counter | Notification emails sent categorized by template. |
| `notifications_delivered_total` | Counter | Real-time notifications delivered categorized by target role. |
| `system_health_status` | Gauge | Global health status (1 = Healthy, 0 = Degraded/Down). |

---

## Health Check Endpoint (`/v1/health`)

Checks connectivity across critical dependencies:
* **Database**: `prisma.$queryRaw` ping query.
* **Redis**: `redis.ping()` status check.
* **Response**: Returns HTTP 200 OK with `{ status: "ok", checks: { database: "up", redis: "up" } }`.
