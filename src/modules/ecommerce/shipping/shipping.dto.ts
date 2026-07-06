import {
  IsString,
  IsNotEmpty,
  IsArray,
  IsOptional,
  IsNumber,
  IsPositive,
  IsEnum,
  IsBoolean,
} from 'class-validator';
import { ShippingMethod, ShippingStrategy } from '@prisma/client';

export class ShippingCartItemDto {
  @IsString()
  @IsNotEmpty()
  vendorProductId: string;

  @IsNumber()
  @IsPositive()
  quantity: number;
}

export class ShippingPreferenceDto {
  @IsString()
  @IsNotEmpty()
  vendorId: string;

  @IsEnum(ShippingMethod, {
    message: 'Method must be either DELIVERY or PICKUP',
  })
  method: ShippingMethod;
}

export class CalculateShippingDto {
  @IsArray()
  items: ShippingCartItemDto[];

  @IsArray()
  @IsOptional()
  preferences?: ShippingPreferenceDto[];
}

export class UpdateShippingProfileDto {
  @IsEnum(ShippingStrategy)
  shippingStrategy: ShippingStrategy;

  @IsNumber()
  baseShippingFee: number;

  @IsNumber()
  additionalItemFee: number;

  @IsNumber()
  @IsOptional()
  freeShippingThreshold?: number;

  @IsBoolean()
  supportsPickup: boolean;

  @IsNumber()
  @IsPositive()
  estimatedDeliveryDays: number;
}
