import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IPaymentProvider, InitializeTxResult, VerifyTxResult } from './payment-provider.interface';
import { Decimal } from '@prisma/client/runtime/library';
import * as crypto from 'crypto';

@Injectable()
export class PaystackProvider implements IPaymentProvider {
  private readonly secretKey: string;
  private readonly baseUrl = 'https://api.paystack.co';

  constructor(private readonly configService: ConfigService) {
    this.secretKey = this.configService.getOrThrow<string>('paystack.apiKey');
  }

  async initializeTransaction(
    email: string,
    amount: Decimal,
    reference: string,
    callbackUrl: string,
    metadata?: Record<string, any>
  ): Promise<InitializeTxResult> {
    try {
      // Paystack accepts amounts in Kobo (1 NGN = 100 Kobo)
      const amountInKobo = Math.round(amount.toNumber() * 100);

      const response = await fetch(`${this.baseUrl}/transaction/initialize`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          amount: amountInKobo,
          reference,
          callback_url: callbackUrl,
          metadata,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.status) {
        throw new Error(data.message || 'Error response from Paystack');
      }

      return {
        authorizationUrl: data.data.authorization_url,
        reference: data.data.reference,
      };
    } catch (error: any) {
      throw new InternalServerErrorException(`Paystack initialization failed: ${error.message}`);
    }
  }

  async verifyTransaction(reference: string): Promise<VerifyTxResult> {
    try {
      const response = await fetch(`${this.baseUrl}/transaction/verify/${encodeURIComponent(reference)}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (!response.ok || !data.status) {
        return {
          status: 'pending',
          amountPaid: new Decimal(0),
          currency: 'NGN',
          gatewayResponse: data.message || 'Transaction verification pending or not found',
          rawResponse: data,
        };
      }

      const txStatus = data.data.status;
      let status: 'success' | 'failed' | 'pending' = 'pending';
      if (txStatus === 'success') {
        status = 'success';
      } else if (txStatus === 'failed') {
        status = 'failed';
      }

      return {
        status,
        amountPaid: new Decimal(data.data.amount / 100),
        currency: data.data.currency || 'NGN',
        gatewayResponse: data.data.gateway_response || '',
        rawResponse: data.data,
      };
    } catch (error: any) {
      throw new InternalServerErrorException(`Paystack verification failed: ${error.message}`);
    }
  }

  verifyWebhookSignature(signature: string, rawBody: string): boolean {
    const hash = crypto
      .createHmac('sha512', this.secretKey)
      .update(rawBody)
      .digest('hex');
    return hash === signature;
  }
}
