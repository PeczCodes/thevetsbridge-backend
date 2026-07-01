import { Controller, Get, Post, Put, Body, Param, UseGuards } from '@nestjs/common';
import { MarketplaceService } from '../marketplace.service';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { RequireProfile } from '../../identity/auth/decorators/require-profile.decorator';
import { RequireProfileGuard } from '../../identity/auth/guards/require-profile.guard';

@Controller('vendor')
@RequireProfile('VENDOR')
@UseGuards(RequireProfileGuard)
export class VendorController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  @Get('stats')
  async getStats(@CurrentUser() user: any) {
    return this.marketplaceService.getVendorStats(user.vendorProfile.id);
  }

  @Get('orders')
  async getOrders(@CurrentUser() user: any) {
    return this.marketplaceService.getVendorOrders(user.vendorProfile.id);
  }

  @Post('products')
  async createProduct(@CurrentUser() user: any, @Body() body: any) {
    return this.marketplaceService.createVendorProduct(user.vendorProfile.id, body);
  }

  @Put('products/:vendorProductId')
  async updateProduct(
    @CurrentUser() user: any,
    @Param('vendorProductId') vendorProductId: string,
    @Body() body: any,
  ) {
    return this.marketplaceService.updateVendorProduct(user.vendorProfile.id, vendorProductId, body);
  }

  @Put('profile')
  async updateProfile(@CurrentUser() user: any, @Body() body: any) {
    return this.marketplaceService.updateVendorProfile(user.vendorProfile.id, user.id, body);
  }
}
