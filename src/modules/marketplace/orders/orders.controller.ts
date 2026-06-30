import { Controller, Post, Body, Get, Query, Patch, Param, Delete } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { PlaceOrderDto } from './dto/place-order.dto';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { Idempotent } from '../../../core/decorators/idempotent.decorator';
import { GetMyOrdersDto } from './dto/get-my-orders.dto';
import { Throttle } from '@nestjs/throttler';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Idempotent()
  async placeOrder(@CurrentUser() user: any, @Body() dto: PlaceOrderDto) {
    return this.ordersService.placeOrder(user.id, dto);
  }

  @Get('my-orders')
  async getMyOrders(
    @CurrentUser() user: any,
    @Query() query: GetMyOrdersDto,
  ) {
    return this.ordersService.getMyOrders(user.id, query, query.status);
  }

  @Patch(':orderId')
  async updateOrderStatus(
    @Param('orderId') orderId: string,
    @Body('orderStatus') orderStatus: string,
  ) {
    return this.ordersService.updateOrderStatus(orderId, orderStatus);
  }

  @Delete(':orderId')
  async deleteOrder(@CurrentUser() user: any, @Param('orderId') orderId: string) {
    return this.ordersService.deleteOrder(user.id, orderId);
  }
}
