import { Module } from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';
import { OrdersService } from '../orders/orders.service';
import { CartService } from '../cart/cart.service';
import { ShippingService } from '../shipping/shipping.service';
import { MarketplaceController } from './marketplace.controller';
import { OrdersController } from '../orders/orders.controller';
import { CartController } from '../cart/cart.controller';
import { VendorController } from '../vendor/vendor.controller';
import { ShippingController } from '../shipping/shipping.controller';
import { PrismaModule } from '../../../../infra/prisma/prisma.module';
import { PaymentsModule } from '../../payments/payments.module';

@Module({
  imports: [PrismaModule, PaymentsModule],
  controllers: [
    MarketplaceController,
    OrdersController,
    CartController,
    VendorController,
    ShippingController,
  ],
  providers: [MarketplaceService, OrdersService, CartService, ShippingService],
  exports: [MarketplaceService, OrdersService, CartService, ShippingService],
})
export class MarketplaceModule {}
