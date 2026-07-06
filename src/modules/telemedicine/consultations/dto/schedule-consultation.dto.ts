import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { ConsultationMode } from '@prisma/client';

export class ScheduleConsultationDto {
  @IsString()
  @IsNotEmpty()
  animalId: string;

  @IsString()
  @IsNotEmpty()
  vetId: string;

  @IsEnum(ConsultationMode)
  @IsNotEmpty()
  mode: ConsultationMode;

  @IsDateString()
  @IsOptional()
  scheduledAt?: string;

  @IsString()
  @IsOptional()
  slotId?: string;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsString()
  @IsOptional()
  symptoms?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsOptional()
  files?: string[];
}
