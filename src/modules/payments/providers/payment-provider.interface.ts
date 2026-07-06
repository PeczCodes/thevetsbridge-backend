import { Decimal } from '@prisma/client/runtime/library';

export interface InitializeTxResult {
  authorizationUrl: string;
  reference: string;
}

export interface VerifyTxResult {
  status: 'success' | 'failed' | 'pending';
  amountPaid: Decimal;
  currency: string;
  gatewayResponse: string;
  rawResponse: any;
}

export interface IPaymentProvider {
  initializeTransaction(
    email: string,
    amount: Decimal,
    reference: string,
    callbackUrl: string,
    metadata?: Record<string, any>,
  ): Promise<InitializeTxResult>;

  verifyTransaction(reference: string): Promise<VerifyTxResult>;

  verifyWebhookSignature(signature: string, rawBody: string): boolean;
}
