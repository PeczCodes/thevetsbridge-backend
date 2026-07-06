import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  Length,
} from 'class-validator';

export class ResolveAccountDto {
  @IsString()
  @IsNotEmpty()
  @Length(10, 10, { message: 'Account number must be exactly 10 digits' })
  accountNumber: string;

  @IsString()
  @IsNotEmpty()
  bankCode: string;
}

export class RegisterPayoutAccountDto {
  @IsString()
  @IsNotEmpty()
  @Length(10, 10, { message: 'Account number must be exactly 10 digits' })
  accountNumber: string;

  @IsString()
  @IsNotEmpty()
  bankCode: string;

  @IsString()
  @IsNotEmpty()
  bankName: string;
}

export class WithdrawRequestDto {
  @IsNumber()
  @IsPositive()
  amount: number;

  @IsString()
  @IsNotEmpty()
  payoutAccountId: string;

  @IsString()
  @IsNotEmpty()
  idempotencyKey: string;
}
