import { Module } from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';
import { OrdersService } from './orders/orders.service';
import { CartService } from './cart/cart.service';
import { MarketplaceController } from './marketplace.controller';
import { OrdersController } from './orders/orders.controller';
import { CartController } from './cart/cart.controller';
import { VendorController } from './vendor.controller';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PrismaModule, PaymentsModule],
  controllers: [MarketplaceController, OrdersController, CartController, VendorController],
  providers: [MarketplaceService, OrdersService, CartService],
  exports: [MarketplaceService, OrdersService, CartService],
})
export class MarketplaceModule {}

