import { IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

export class AddCartItemDto {
  @IsString()
  @IsNotEmpty()
  vendorProductId: string;

  @IsNumber()
  @Min(1)
  @IsNotEmpty()
  quantity: number;
}
