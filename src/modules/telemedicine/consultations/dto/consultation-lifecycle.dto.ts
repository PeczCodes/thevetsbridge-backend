import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsOptional,
  IsDateString,
  IsEnum,
  Min,
  Max,
  IsBoolean,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SubmitSummaryDto {
  @IsString()
  @IsNotEmpty()
  diagnosis: string;

  @IsString()
  @IsNotEmpty()
  findings: string;

  @IsString()
  @IsNotEmpty()
  treatment: string;

  @IsString()
  @IsNotEmpty()
  recommendations: string;

  @IsOptional()
  @IsDateString()
  followUpDate?: string;

  @IsOptional()
  files?: any;
}

export class SubmitReviewDto {
  @IsNumber()
  @Min(1)
  @Max(5)
  rating: number;

  @IsOptional()
  @IsString()
  comment?: string;
}

export class SubmitFeedbackDto {
  @IsBoolean()
  cooperative: boolean;

  @IsBoolean()
  late: boolean;

  @IsBoolean()
  abusive: boolean;

  @IsOptional()
  @IsString()
  comments?: string;
}

export class OpenDisputeDto {
  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsOptional()
  @IsString()
  details?: string;
}

export class ResolveDisputeDto {
  @IsEnum(['RELEASE', 'REFUND'])
  action: 'RELEASE' | 'REFUND';

  @IsOptional()
  @IsString()
  resolutionNotes?: string;
}
