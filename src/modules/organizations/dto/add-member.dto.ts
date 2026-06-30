import { IsNotEmpty, IsString, IsEnum } from 'class-validator';
import { OrganizationRole } from '@prisma/client';

export class AddMemberDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsEnum(OrganizationRole)
  @IsNotEmpty()
  role: OrganizationRole;
}
