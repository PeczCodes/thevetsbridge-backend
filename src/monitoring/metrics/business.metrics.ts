import { makeCounterProvider } from '@willsoto/nestjs-prometheus';

// Telemedicine
export const TELEMEDICINE_CONSULTATIONS_CREATED_TOTAL = 'telemedicine_consultations_created_total';
export const TELEMEDICINE_CONSULTATIONS_STARTED_TOTAL = 'telemedicine_consultations_started_total';
export const TELEMEDICINE_CONSULTATIONS_COMPLETED_TOTAL = 'telemedicine_consultations_completed_total';
export const TELEMEDICINE_CONSULTATIONS_CANCELLED_TOTAL = 'telemedicine_consultations_cancelled_total';

// Appointments
export const APPOINTMENTS_BOOKED_TOTAL = 'appointments_booked_total';
export const APPOINTMENTS_CANCELLED_TOTAL = 'appointments_cancelled_total';

// Payments
export const PAYMENT_ATTEMPTS_TOTAL = 'payment_attempts_total';
export const PAYMENT_SUCCESSES_TOTAL = 'payment_successes_total';
export const PAYMENT_FAILURES_TOTAL = 'payment_failures_total';
export const PAYMENT_REFUNDS_TOTAL = 'payment_refunds_total';

// Marketplace
export const MARKETPLACE_ORDERS_PLACED_TOTAL = 'marketplace_orders_placed_total';
export const MARKETPLACE_ORDERS_COMPLETED_TOTAL = 'marketplace_orders_completed_total';
export const MARKETPLACE_ORDERS_CANCELLED_TOTAL = 'marketplace_orders_cancelled_total';

// Notifications
export const NOTIFICATIONS_CREATED_TOTAL = 'notifications_created_total';
export const NOTIFICATIONS_DELIVERED_TOTAL = 'notifications_delivered_total';
export const NOTIFICATIONS_FAILED_TOTAL = 'notifications_failed_total';

// Emails
export const EMAILS_QUEUED_TOTAL = 'emails_queued_total';
export const EMAILS_SENT_TOTAL = 'emails_sent_total';
export const EMAIL_FAILURES_TOTAL = 'email_failures_total';

export const businessMetricsProviders = [
  // Telemedicine
  makeCounterProvider({
    name: TELEMEDICINE_CONSULTATIONS_CREATED_TOTAL,
    help: 'Total number of telemedicine consultations created',
    labelNames: ['type'],
  }),
  makeCounterProvider({
    name: TELEMEDICINE_CONSULTATIONS_STARTED_TOTAL,
    help: 'Total number of telemedicine consultations started',
    labelNames: ['type'],
  }),
  makeCounterProvider({
    name: TELEMEDICINE_CONSULTATIONS_COMPLETED_TOTAL,
    help: 'Total number of telemedicine consultations completed',
    labelNames: ['type'],
  }),
  makeCounterProvider({
    name: TELEMEDICINE_CONSULTATIONS_CANCELLED_TOTAL,
    help: 'Total number of telemedicine consultations cancelled',
    labelNames: ['reason'],
  }),

  // Appointments
  makeCounterProvider({
    name: APPOINTMENTS_BOOKED_TOTAL,
    help: 'Total number of appointment bookings',
    labelNames: ['type'],
  }),
  makeCounterProvider({
    name: APPOINTMENTS_CANCELLED_TOTAL,
    help: 'Total number of cancelled appointments',
    labelNames: ['reason'],
  }),

  // Payments
  makeCounterProvider({
    name: PAYMENT_ATTEMPTS_TOTAL,
    help: 'Total number of payment transaction attempts',
    labelNames: ['purpose', 'channel'],
  }),
  makeCounterProvider({
    name: PAYMENT_SUCCESSES_TOTAL,
    help: 'Total number of successful payments',
    labelNames: ['purpose'],
  }),
  makeCounterProvider({
    name: PAYMENT_FAILURES_TOTAL,
    help: 'Total number of failed payments',
    labelNames: ['purpose', 'error_type'],
  }),
  makeCounterProvider({
    name: PAYMENT_REFUNDS_TOTAL,
    help: 'Total number of processed refunds',
    labelNames: ['purpose'],
  }),

  // Marketplace
  makeCounterProvider({
    name: MARKETPLACE_ORDERS_PLACED_TOTAL,
    help: 'Total number of marketplace orders placed',
  }),
  makeCounterProvider({
    name: MARKETPLACE_ORDERS_COMPLETED_TOTAL,
    help: 'Total number of completed marketplace orders',
  }),
  makeCounterProvider({
    name: MARKETPLACE_ORDERS_CANCELLED_TOTAL,
    help: 'Total number of cancelled marketplace orders',
  }),

  // Notifications
  makeCounterProvider({
    name: NOTIFICATIONS_CREATED_TOTAL,
    help: 'Total number of notifications created',
    labelNames: ['role'],
  }),
  makeCounterProvider({
    name: NOTIFICATIONS_DELIVERED_TOTAL,
    help: 'Total number of notifications delivered',
    labelNames: ['role'],
  }),
  makeCounterProvider({
    name: NOTIFICATIONS_FAILED_TOTAL,
    help: 'Total number of failed notifications',
    labelNames: ['role'],
  }),

  // Email
  makeCounterProvider({
    name: EMAILS_QUEUED_TOTAL,
    help: 'Total number of emails queued for delivery',
    labelNames: ['template'],
  }),
  makeCounterProvider({
    name: EMAILS_SENT_TOTAL,
    help: 'Total number of emails successfully sent',
    labelNames: ['template'],
  }),
  makeCounterProvider({
    name: EMAIL_FAILURES_TOTAL,
    help: 'Total number of email dispatch failures',
    labelNames: ['template'],
  }),
];
