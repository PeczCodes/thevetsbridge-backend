import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
  IsEnum,
  IsInt,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';
import { VetSpecialization } from '@prisma/client';

export class VetProfilePayloadDto {
  @IsOptional()
  @IsString()
  licenseNumber?: string;

  @IsOptional()
  @IsString()
  licenseCountry?: string;

  @IsOptional()
  @IsString()
  licenseDocUrl?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(VetSpecialization, { each: true })
  specializations?: VetSpecialization[];

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  experience?: number;

  @IsOptional()
  @IsString()
  bio?: string;
}

export class VendorProfilePayloadDto {
  @IsOptional()
  @IsString()
  businessName?: string;

  @IsOptional()
  @IsString()
  businessPhone?: string;

  @IsOptional()
  @IsString()
  businessAddress?: string;

  @IsOptional()
  @IsString()
  bio?: string;
}

export class RegisterDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @MinLength(8)
  @IsNotEmpty()
  password: string;

  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsString()
  @IsOptional()
  displayName?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => VetProfilePayloadDto)
  vetProfile?: VetProfilePayloadDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => VendorProfilePayloadDto)
  vendorProfile?: VendorProfilePayloadDto;

  @IsString()
  @IsOptional()
  timezone?: string;
}

export class LinkVetProfileDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;

  @IsString()
  @IsOptional()
  licenseNumber?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(VetSpecialization, { each: true })
  specializations?: VetSpecialization[];

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  experience?: number;

  @IsOptional()
  @IsString()
  bio?: string;
}

export class LinkVendorProfileDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;

  @IsOptional()
  @IsString()
  businessName?: string;

  @IsOptional()
  @IsString()
  businessPhone?: string;

  @IsOptional()
  @IsString()
  businessAddress?: string;

  @IsOptional()
  @IsString()
  bio?: string;
}
