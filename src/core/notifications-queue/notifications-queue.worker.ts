import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { getEmailTemplate } from '../utils/email-templates';
import { PrismaService } from '../prisma/prisma.service';

@Processor('notifications')
export class NotificationsQueueWorker extends WorkerHost {
  private readonly logger = new Logger(NotificationsQueueWorker.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<any>): Promise<any> {
    const { name, data } = job;
    this.logger.log(`[Queue Worker] Processing direct notification job ${job.id} | Name: ${name}`);

    switch (name) {
      case 'send-push':
        this.logger.log(`[Queue Worker] [PUSH] Sending push notification to User ID ${data.userId} | Title: "${data.title}" | Body: "${data.body}"`);
        break;
      
      case 'send-email': {
        const { to, subject: customSubject, template, context } = data;
        this.logger.log(`[Queue Worker] [EMAIL] Preparing email dispatch to ${to} for template "${template}"`);

        // Safe check for delayed email reminders: if consultation is no longer SCHEDULED, do not send
        if (context?.consultationId && (template === 'CONSULTATION_REMINDER_CUSTOMER' || template === 'CONSULTATION_REMINDER_VET')) {
          const consultation = await this.prisma.consultation.findUnique({
            where: { id: context.consultationId },
          });
          if (!consultation || consultation.status !== 'SCHEDULED') {
            this.logger.log(
              `[Queue Worker] [EMAIL] Skipping reminder email for Consultation ID ${context.consultationId} because its current status is "${consultation?.status || 'DELETED'}" (expected "SCHEDULED")`
            );
            return { skipped: true, reason: 'Consultation is no longer SCHEDULED' };
          }
        }
        
        // Compile HTML template
        const { subject: templateSubject, html } = getEmailTemplate(template, context);
        const finalSubject = customSubject || templateSubject;

        // Resolve Resend credentials and from address
        const apiKey = this.configService.get<string>('RESEND_API_KEY') || '';
        const rawFrom = 'VetsBridge <onboarding@resend.dev>';
        
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
          this.logger.log(`[Queue Worker] [EMAIL] Dispatching POST request to Resend API for ${to}`);
          const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: rawFrom.includes('onboarding@resend.dev') ? 'onboarding@resend.dev' : rawFrom,
              to: [to],
              subject: finalSubject,
              html: html,
            }),
          });

          if (!response.ok) {
            const errBody = await response.text();
            throw new Error(`Resend API error (${response.status}): ${errBody}`);
          }

          const resData: any = await response.json();
          this.logger.log(`[Queue Worker] [EMAIL] Email successfully sent via Resend to ${to}. Email ID: ${resData.id}`);
        } catch (error: any) {
          this.logger.error(`[Queue Worker] [EMAIL] Failed to send email to ${to} via Resend. Retrying job. Error: ${error.message}`);
          throw error; // throw to trigger BullMQ retry
        }
        break;
      }

      default:
        this.logger.warn(`[Queue Worker] Unsupported notification job name: ${name}`);
    }

    return { success: true, jobId: job.id };
  }
}
