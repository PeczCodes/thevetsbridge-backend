import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../../../core/dto/pagination.dto';

export class GetConsultationsDto extends PaginationDto {
  @IsOptional()
  @IsString()
  status?: string;
}
