import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { getEmailTemplate } from '../../../common/utils/email-templates';
import { PrismaService } from '../../prisma/prisma.service';
import { CircuitBreakerService } from '../../circuit-breaker/circuit-breaker.service';
import { ExternalServiceException } from '../../circuit-breaker/exceptions/external-service.exception';
import { MonitoringService } from '../../../src/monitoring/monitoring.service';
import {
  EMAILS_SENT_TOTAL,
  EMAIL_FAILURES_TOTAL,
  NOTIFICATIONS_DELIVERED_TOTAL,
  NOTIFICATIONS_FAILED_TOTAL,
} from '../../../src/monitoring/metrics/business.metrics';

@Processor('notifications')
export class NotificationsQueueWorker extends WorkerHost {
  private readonly logger = new Logger(NotificationsQueueWorker.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly circuitBreakerService: CircuitBreakerService,
    @Optional() private readonly monitoringService?: MonitoringService,
  ) {
    super();
  }

  async process(job: Job<any>): Promise<any> {
    const { name, data } = job;
    this.logger.log(`[Queue Worker] Processing direct notification job ${job.id} | Name: ${name}`);

    switch (name) {
      case 'send-push':
        this.logger.log(`[Queue Worker] [PUSH] Sending push notification to User ID ${data.userId} | Title: "${data.title}" | Body: "${data.body}"`);
        this.monitoringService?.incrementCounter(NOTIFICATIONS_DELIVERED_TOTAL, 1, { role: data?.data?.targetRole || 'unknown' });
        break;
      
      case 'send-email': {
        const { to, subject: customSubject, template, context } = data;
        this.logger.log(`[Queue Worker] [EMAIL] Preparing email dispatch to ${to} for template "${template}"`);

        // Safe check for delayed email reminders: if consultation is no longer SCHEDULED, do not send
        if (context?.consultationId && (template === 'CONSULTATION_REMINDER_CUSTOMER' || template === 'CONSULTATION_REMINDER_VET')) {
          const consultation = await this.prisma.consultation.findUnique({
            where: { id: context.consultationId },
          });
          if (!consultation || consultation.status !== 'CONFIRMED') {
            this.logger.log(
              `[Queue Worker] [EMAIL] Skipping reminder email for Consultation ID ${context.consultationId} because its current status is "${consultation?.status || 'DELETED'}" (expected "CONFIRMED")`
            );
            return { skipped: true, reason: 'Consultation is no longer CONFIRMED' };
          }
        }
        
        // Compile HTML & Plain Text template
        const { subject: templateSubject, html, text } = getEmailTemplate(template, context);
        const finalSubject = customSubject || templateSubject;

        // Resolve Resend credentials and from address
        const apiKey = this.configService.get<string>('RESEND_API_KEY') || '';
        const resendFromEnv = this.configService.get<string>('RESEND_FROM_EMAIL');
        const smtpFromEnv = this.configService.get<string>('SMTP_FROM');
        const rawFrom = resendFromEnv || smtpFromEnv || 'VetsBridge <onboarding@resend.dev>';

        // If Resend key is missing or default placeholder, log HTML to console for local testing
        if (!apiKey || apiKey === 'placeholder' || apiKey.startsWith('your_') || apiKey.startsWith('re_placeholder')) {
          this.logger.warn(`[Queue Worker] [EMAIL] RESEND_API_KEY is not configured or is a placeholder. FALLING BACK TO LOGGING EMAIL.`);
          this.logger.log(`
=========================================
EMAIL FALLBACK LOG
Recipient: ${to}
Subject: ${finalSubject}
From: ${rawFrom}
HTML Content:
${html}
=========================================
          `);
          break;
        }

        try {
          this.logger.log(`[Queue Worker] [EMAIL] Dispatching POST request to Resend API for ${to} | From: ${rawFrom}`);
          
          // Wrap with resend circuit breaker and align abort signals
          const response = await this.circuitBreakerService.execute(
            'resend',
            async () => {
              const resendConfig = this.configService.get('circuitBreaker.providers.resend');
              const timeoutMs = Number(resendConfig?.timeout || 50000);

              const controller = new AbortController();
              const id = setTimeout(() => controller.abort(), timeoutMs);
              try {
                return await fetch('https://api.resend.com/emails', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    from: rawFrom,
                    to: Array.isArray(to) ? to : [to],
                    subject: finalSubject,
                    html: html,
                    text: text,
                  }),
                  signal: controller.signal,
                });
              } finally {
                clearTimeout(id);
              }
            }
          );

          if (!response.ok) {
            const errBody = await response.text();
            this.logger.error(`[Queue Worker] [EMAIL] Resend API responded with error ${response.status}: ${errBody}`);
            this.monitoringService?.incrementCounter(EMAIL_FAILURES_TOTAL, 1, { template: template || 'unknown' });
            throw new ExternalServiceException({
              provider: 'resend',
              message: `Resend API error (${response.status}): ${errBody}`,
              retryable: response.status >= 500 || response.status === 429,
              statusCode: response.status,
            });
          }

          const resData: any = await response.json();
          this.logger.log(`[Queue Worker] [EMAIL] Email successfully sent via Resend to ${to}. Email ID: ${resData.id}`);
          this.monitoringService?.incrementCounter(EMAILS_SENT_TOTAL, 1, { template: template || 'unknown' });
        } catch (error: any) {
          this.logger.error(`[Queue Worker] [EMAIL] Failed to send email to ${to} via Resend. Retrying job. Error: ${error.message}`);
          if (error instanceof ExternalServiceException) {
            throw error;
          }
          this.monitoringService?.incrementCounter(EMAIL_FAILURES_TOTAL, 1, { template: template || 'unknown' });
          const isAbort = error.name === 'AbortError' || error.message?.includes('timeout') || error.message?.includes('Timed out');
          throw new ExternalServiceException({
            provider: 'resend',
            message: `Resend API request failed: ${error.message}`,
            retryable: isAbort || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT',
            statusCode: isAbort ? 504 : 502,
            reason: error,
          });
        }
        break;
      }

      default:
        this.logger.warn(`[Queue Worker] Unsupported notification job name: ${name}`);
        this.monitoringService?.incrementCounter(NOTIFICATIONS_FAILED_TOTAL, 1, { role: 'unknown' });
    }

    return { success: true, jobId: job.id };
  }
}
