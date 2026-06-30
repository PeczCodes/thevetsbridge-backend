import { IsOptional, IsNumber, IsInt, IsString } from 'class-validator';

export class CreateAnimalHealthLogDto {
  @IsOptional()
  @IsNumber()
  weight?: number;

  @IsOptional()
  @IsNumber()
  temperature?: number;

  @IsOptional()
  @IsInt()
  heartRate?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
