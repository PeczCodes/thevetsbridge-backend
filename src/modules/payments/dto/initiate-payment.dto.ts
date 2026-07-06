import { IsNotEmpty, IsEnum, IsString, IsUrl } from 'class-validator';
import { PaymentPurpose } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class InitiatePaymentDto {
  @ApiProperty({
    enum: PaymentPurpose,
    description: 'Purpose of payment (ORDER or APPOINTMENT)',
    example: PaymentPurpose.ORDER,
  })
  @IsEnum(PaymentPurpose, {
    message: 'Invalid payment purpose. Must be ORDER or APPOINTMENT',
  })
  purpose: PaymentPurpose;

  @ApiProperty({
    description: 'The ID of the target order or appointment database record',
    example: 'cjl3201a00000000000000000',
  })
  @IsString()
  @IsNotEmpty({ message: 'Target ID is required' })
  targetId: string;

  @ApiProperty({
    description:
      'The absolute frontend redirect callback URL returned by the payment gateway post-transaction',
    example: 'http://localhost:3000/payments/callback',
  })
  @IsUrl({ require_tld: false }, { message: 'Invalid redirect callback URL' })
  callbackUrl: string;
}
