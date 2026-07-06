import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
  IsEnum,
} from 'class-validator';
import { ShippingMethod } from '@prisma/client';

export class OrderItemDto {
  @IsString()
  @IsNotEmpty()
  vendorProductId: string;

  @IsNumber()
  @Min(1)
  @IsNotEmpty()
  quantity: number;
}

export class OrderShipmentPreferenceDto {
  @IsString()
  @IsNotEmpty()
  vendorId: string;

  @IsEnum(ShippingMethod)
  method: ShippingMethod;
}

export class PlaceOrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  @IsNotEmpty()
  items: OrderItemDto[];

  @IsString()
  @IsOptional()
  shippingAddressId?: string;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => OrderShipmentPreferenceDto)
  shipmentPreferences?: OrderShipmentPreferenceDto[];
}
