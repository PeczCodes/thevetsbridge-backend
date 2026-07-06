import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  IsInt,
} from 'class-validator';
import {
  AnimalType,
  AnimalSex,
  HealthStatus,
  AnimalAgeType,
} from '@prisma/client';

export class CreateAnimalDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  species: string;

  @IsString()
  @IsOptional()
  breed?: string;

  @IsEnum(AnimalType)
  @IsNotEmpty()
  type: AnimalType;

  @IsString()
  @IsOptional()
  organizationId?: string;

  @IsString()
  @IsOptional()
  photoUrl?: string;

  @IsEnum(AnimalSex)
  @IsOptional()
  sex?: AnimalSex;

  @IsString()
  @IsOptional()
  birthDate?: string;

  @IsEnum(HealthStatus)
  @IsOptional()
  healthStatus?: HealthStatus;

  @IsNumber()
  @IsOptional()
  weight?: number;

  @IsString()
  @IsOptional()
  medicalNotes?: string;

  @IsInt()
  @IsOptional()
  estimatedAgeMonths?: number;

  @IsEnum(AnimalAgeType)
  @IsOptional()
  ageType?: AnimalAgeType;
}
