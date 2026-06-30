import { registerAs } from '@nestjs/config';

export const paystackConfig = registerAs('paystack', () => ({
  apiKey: process.env.PAYSTACK_SECRET_KEY,
}));