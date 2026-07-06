import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseIntPipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CartService } from './cart.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';

@Controller('ecommerce/cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  async getCart(@CurrentUser() user: any) {
    return this.cartService.getOrCreateCart(user.id);
  }

  @Post('items')
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  async addItem(@CurrentUser() user: any, @Body() dto: AddCartItemDto) {
    return this.cartService.addItem(user.id, dto);
  }

  @Patch('items/:vendorProductId')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async updateQuantity(
    @CurrentUser() user: any,
    @Param('vendorProductId') vendorProductId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cartService.updateQuantity(
      user.id,
      vendorProductId,
      dto.quantity,
    );
  }

  @Delete('items/:vendorProductId')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async removeItem(
    @CurrentUser() user: any,
    @Param('vendorProductId') vendorProductId: string,
  ) {
    return this.cartService.removeItem(user.id, vendorProductId);
  }

  @Delete()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async clearCart(@CurrentUser() user: any) {
    return this.cartService.clearCart(user.id);
  }
}
