import { IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

export class CreateListingDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsNumber()
  @Min(0)
  @IsNotEmpty()
  price: number;

  @IsNumber()
  @Min(0)
  @IsNotEmpty()
  stock: number;
}
