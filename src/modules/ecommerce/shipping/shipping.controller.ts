import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ShippingService } from './shipping.service';
import { CalculateShippingDto } from './shipping.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '../../identity/auth/decorators/public.decorator';

@ApiTags('Shipping')
@Controller('ecommerce/shipping')
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  @Post('calculate')
  @HttpCode(HttpStatus.OK)
  @Public() // Can be queried by guests or logged-in users during checkout estimate
  @ApiOperation({
    summary:
      'Calculate server-authoritative shipping breakdown grouped by vendor',
  })
  async calculateShipping(@Body() dto: CalculateShippingDto) {
    return this.shippingService.calculateShipping(dto);
  }
}
