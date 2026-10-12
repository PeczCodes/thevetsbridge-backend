import {
  Controller,
  Post,
  Body,
  Get,
  Query,
  Patch,
  Param,
  Delete,
  UseInterceptors,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { PlaceOrderDto } from './dto/place-order.dto';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { Idempotent } from '../../../../common/decorators/idempotent.decorator';
import { IdempotencyInterceptor } from '../../../../common/interceptors/idempotency.interceptor';
import { GetMyOrdersDto } from './dto/get-my-orders.dto';
import { Throttle } from '@nestjs/throttler';
import { OrderUserPayload } from './types/order.types';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @UseInterceptors(IdempotencyInterceptor)
  @Idempotent()
  async placeOrder(
    @CurrentUser() user: OrderUserPayload,
    @Body() dto: PlaceOrderDto,
  ) {
    return this.ordersService.placeOrder(user.id, dto);
  }

  @Get('my-orders')
  async getMyOrders(
    @CurrentUser() user: OrderUserPayload,
    @Query() query: GetMyOrdersDto,
  ) {
    return this.ordersService.getMyOrders(user.id, query, query.status);
  }

  @Patch(':orderId')
  async updateOrderStatus(
    @CurrentUser() user: OrderUserPayload,
    @Param('orderId') orderId: string,
    @Body() body: { orderStatus?: string; status?: string },
  ) {
    const status = body?.orderStatus || body?.status;
    return this.ordersService.updateOrderStatus(user, orderId, status);
  }

  @Delete(':orderId')
  async deleteOrder(
    @CurrentUser() user: OrderUserPayload,
    @Param('orderId') orderId: string,
  ) {
    return this.ordersService.deleteOrder(user.id, orderId);
  }
}
