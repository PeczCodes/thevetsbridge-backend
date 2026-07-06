import { registerAs } from '@nestjs/config';

export const telemedicineConfig = registerAs('telemedicine', () => ({
  noShowGracePeriodMinutes: parseInt(process.env.TELEMEDICINE_NO_SHOW_GRACE_MINUTES || '15', 10),
  heartbeatIntervalSeconds: parseInt(process.env.TELEMEDICINE_HEARTBEAT_INTERVAL_SECONDS || '15', 10),
  heartbeatTimeoutSeconds: parseInt(process.env.TELEMEDICINE_HEARTBEAT_TIMEOUT_SECONDS || '30', 10),
  reconnectTimeoutSeconds: parseInt(process.env.TELEMEDICINE_RECONNECT_TIMEOUT_SECONDS || '300', 10), // 5 minutes
  disputeWindowHours: parseInt(process.env.TELEMEDICINE_DISPUTE_WINDOW_HOURS || '24', 10),
}));
