import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateAddressDto {
  @IsString()
  @IsOptional()
  label?: string;

  @IsString()
  @IsOptional()
  street1?: string;

  @IsString()
  @IsOptional()
  street2?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  state?: string;

  @IsString()
  @IsOptional()
  country?: string;

  @IsString()
  @IsOptional()
  postalCode?: string;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}
