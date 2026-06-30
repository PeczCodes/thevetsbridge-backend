import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { OrganizationType } from '@prisma/client';

export class CreateOrganizationDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(OrganizationType)
  @IsNotEmpty()
  type: OrganizationType;
}
