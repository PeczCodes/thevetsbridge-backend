import { IsEnum, IsOptional, IsString, IsNumber, IsInt } from 'class-validator';
import {
  AnimalType,
  AnimalSex,
  HealthStatus,
  AnimalAgeType,
} from '@prisma/client';

export class UpdateAnimalDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  species?: string;

  @IsString()
  @IsOptional()
  breed?: string;

  @IsEnum(AnimalType)
  @IsOptional()
  type?: AnimalType;

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
