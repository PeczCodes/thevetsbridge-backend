import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../../../core/dto/pagination.dto';

export class GetMyOrdersDto extends PaginationDto {
  @IsOptional()
  @IsString()
  status?: string;
}
