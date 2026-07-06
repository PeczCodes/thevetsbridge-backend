import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DeleteAccountDto {
  @ApiProperty({
    example: 'Password123!',
    description: 'Password of the user for confirmation',
  })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
