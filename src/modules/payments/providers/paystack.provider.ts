import { Injectable, OnModuleInit, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IPaymentProvider,
  InitializeTxResult,
  VerifyTxResult,
} from './payment-provider.interface';
import { Decimal } from '@prisma/client/runtime/library';
import * as crypto from 'crypto';
import { CircuitBreakerService } from '../../../../infra/circuit-breaker/circuit-breaker.service';
import { ExternalServiceException } from '../../../../infra/circuit-breaker/exceptions/external-service.exception';
import { MonitoringService } from '../../../monitoring/monitoring.service';
import {
  PAYMENT_ATTEMPTS_TOTAL,
  PAYMENT_SUCCESSES_TOTAL,
  PAYMENT_FAILURES_TOTAL,
  PAYMENT_REFUNDS_TOTAL,
} from '../../../monitoring/metrics/business.metrics';

@Injectable()
export class PaystackProvider implements IPaymentProvider, OnModuleInit {
  private readonly secretKey: string;
  private readonly baseUrl = 'https://api.paystack.co';
  private readonly logger = new Logger(PaystackProvider.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly circuitBreakerService: CircuitBreakerService,
    @Optional() private readonly monitoringService?: MonitoringService,
  ) {
    this.secretKey =
      this.configService.get<string>('paystack.apiKey') || 'DISABLED';
  }

  async onModuleInit() {
    if (this.secretKey === 'DISABLED') {
      this.logger.warn(
        'Paystack API Key is not configured. Payment operations are temporarily unavailable.',
      );
      return;
    }

    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 2000);

      await this.circuitBreakerService.execute(
        'paystack',
        async () => {
          const res = await fetch(this.baseUrl, {
            method: 'GET',
            signal: controller.signal,
          });
          if (!res.ok) throw new Error(`Status: ${res.status}`);
          return res;
        },
        { timeout: 3000 },
      );

      clearTimeout(id);
      this.logger.log('Paystack connected.');
    } catch (error: any) {
      this.logger.warn(
        `Paystack unavailable. Payment operations are temporarily unavailable. Error: ${error.message}`,
      );
    }
  }

  /**
   * Helper request method that channels all HTTP fetch calls through Opossum
   */
  private async request(
    path: string,
    options: RequestInit,
    timeoutMs = 5000,
  ): Promise<any> {
    if (this.secretKey === 'DISABLED') {
      throw new ExternalServiceException({
        provider: 'paystack',
        message: 'Paystack payment operations are temporarily disabled.',
        retryable: false,
        statusCode: 503,
      });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;

    try {
      const response = await this.circuitBreakerService.execute(
        'paystack',
        async () => {
          return fetch(url, {
            ...options,
            headers: {
              Authorization: `Bearer ${this.secretKey}`,
              'Content-Type': 'application/json',
              ...options.headers,
            },
            signal: controller.signal,
          });
        },
        {
          timeout: timeoutMs + 1000, // align breaker timeout with fetch timeout, giving a small safety gap
        },
      );

      clearTimeout(timeoutId);
      const data = await response.json();

      if (!response.ok) {
        throw new ExternalServiceException({
          provider: 'paystack',
          message:
            data.message ||
            `Paystack request failed with status: ${response.status}`,
          retryable: response.status >= 500 || response.status === 429,
          statusCode: response.status,
          reason: data,
        });
      }

      return data;
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error instanceof ExternalServiceException) {
        throw error;
      }
      const isAbort =
        error.name === 'AbortError' ||
        error.message?.includes('timeout') ||
        error.message?.includes('Timed out');
      throw new ExternalServiceException({
        provider: 'paystack',
        message: `Paystack API request failed: ${error.message}`,
        retryable:
          isAbort || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT',
        statusCode: isAbort ? 504 : 502,
        reason: error,
      });
    }
  }

  async initializeTransaction(
    email: string,
    amount: Decimal,
    reference: string,
    callbackUrl: string,
    metadata?: Record<string, any>,
  ): Promise<InitializeTxResult> {
    const amountInKobo = Math.round(amount.toNumber() * 100);
    const purpose = metadata?.purpose || 'consultation';

    this.monitoringService?.incrementCounter(PAYMENT_ATTEMPTS_TOTAL, 1, { purpose, channel: 'paystack' });

    const data = await this.request('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        email,
        amount: amountInKobo,
        reference,
        callback_url: callbackUrl,
        metadata,
      }),
    });

    if (!data.status) {
      this.monitoringService?.incrementCounter(PAYMENT_FAILURES_TOTAL, 1, { purpose, error_type: 'init_failed' });
      throw new ExternalServiceException({
        provider: 'paystack',
        message: data.message || 'Error response from Paystack',
        retryable: false,
      });
    }

    return {
      authorizationUrl: data.data.authorization_url,
      reference: data.data.reference,
    };
  }

  async verifyTransaction(reference: string): Promise<VerifyTxResult> {
    const data = await this.request(
      `/transaction/verify/${encodeURIComponent(reference)}`,
      {
        method: 'GET',
      },
    );

    if (!data.status) {
      return {
        status: 'pending',
        amountPaid: new Decimal(0),
        currency: 'NGN',
        gatewayResponse:
          data.message || 'Transaction verification pending or not found',
        rawResponse: data,
      };
    }

    const txStatus = data.data.status;
    let status: 'success' | 'failed' | 'pending' = 'pending';
    const purpose = data.data.metadata?.purpose || 'consultation';

    if (txStatus === 'success') {
      status = 'success';
      this.monitoringService?.incrementCounter(PAYMENT_SUCCESSES_TOTAL, 1, { purpose });
    } else if (txStatus === 'failed') {
      status = 'failed';
      this.monitoringService?.incrementCounter(PAYMENT_FAILURES_TOTAL, 1, { purpose, error_type: 'gateway_declined' });
    }

    return {
      status,
      amountPaid: new Decimal(data.data.amount / 100),
      currency: data.data.currency || 'NGN',
      gatewayResponse: data.data.gateway_response || '',
      rawResponse: data.data,
    };
  }

  verifyWebhookSignature(signature: string, rawBody: string): boolean {
    if (this.secretKey === 'DISABLED' || !signature || !rawBody) {
      return false;
    }
    const hash = crypto
      .createHmac('sha512', this.secretKey)
      .update(rawBody)
      .digest('hex');

    const hashBuf = Buffer.from(hash, 'utf8');
    const sigBuf = Buffer.from(signature, 'utf8');

    if (hashBuf.length !== sigBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(hashBuf, sigBuf);
  }

  async listSupportedBanks(): Promise<Array<{ name: string; code: string }>> {
    const data = await this.request('/bank?country=nigeria', {
      method: 'GET',
    });

    if (!data.status) {
      throw new ExternalServiceException({
        provider: 'paystack',
        message: data.message || 'Error fetching bank list from Paystack',
        retryable: false,
      });
    }

    return data.data.map((bank: any) => ({
      name: bank.name,
      code: bank.code,
    }));
  }

  async resolveAccountNumber(
    accountNumber: string,
    bankCode: string,
  ): Promise<string> {
    const data = await this.request(
      `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
      {
        method: 'GET',
      },
    );

    if (!data.status) {
      throw new ExternalServiceException({
        provider: 'paystack',
        message: data.message || 'Could not resolve bank account details',
        retryable: false,
      });
    }

    return data.data.account_name;
  }

  async createTransferRecipient(
    accountNumber: string,
    bankCode: string,
    name: string,
  ): Promise<string> {
    const data = await this.request('/transferrecipient', {
      method: 'POST',
      body: JSON.stringify({
        type: 'nuban',
        name,
        account_number: accountNumber,
        bank_code: bankCode,
        currency: 'NGN',
      }),
    });

    if (!data.status) {
      throw new ExternalServiceException({
        provider: 'paystack',
        message: data.message || 'Error creating Paystack transfer recipient',
        retryable: false,
      });
    }

    return data.data.recipient_code;
  }

  async initiateTransfer(
    amount: Decimal,
    recipientCode: string,
    reference: string,
    reason?: string,
  ): Promise<{ transferCode: string; status: string }> {
    const amountInKobo = Math.round(amount.toNumber() * 100);

    const data = await this.request(
      '/transfer',
      {
        method: 'POST',
        body: JSON.stringify({
          source: 'balance',
          amount: amountInKobo,
          recipient: recipientCode,
          reference: reference,
          reason: reason || 'VetsBridge Payout Withdrawal',
        }),
      },
      15000,
    ); // 15s timeout override for initiates

    if (!data.status) {
      throw new ExternalServiceException({
        provider: 'paystack',
        message: data.message || 'Paystack transfer request failed',
        retryable: false,
      });
    }

    return {
      transferCode: data.data.transfer_code,
      status: data.data.status, // success, pending, otp, failed
    };
  }
}
