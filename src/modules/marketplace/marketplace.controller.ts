import { Controller, Post, Body, Get, UseGuards, Param, Patch } from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';
import { CreateProductDto } from './dto/create-product.dto';
import { CreateListingDto } from './dto/create-listing.dto';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { RequireProfile } from '../identity/auth/decorators/require-profile.decorator';
import { RequireProfileGuard } from '../identity/auth/guards/require-profile.guard';
import { Public } from '../identity/auth/decorators/public.decorator';

@Controller('marketplace')
export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  @Post('products')
  @RequireProfile('VENDOR')
  @UseGuards(RequireProfileGuard)
  async createProduct(@Body() dto: CreateProductDto) {
    return this.marketplaceService.createProduct(dto);
  }

  @Post('listings')
  @RequireProfile('VENDOR')
  @UseGuards(RequireProfileGuard)
  async createListing(@CurrentUser() user: any, @Body() dto: CreateListingDto) {
    return this.marketplaceService.createListing(user.vendorProfile.id, dto);
  }

  @Get('products/vendor')
  @RequireProfile('VENDOR')
  @UseGuards(RequireProfileGuard)
  async getVendorProducts(@CurrentUser() user: any) {
    return this.marketplaceService.getVendorProducts(user.vendorProfile.id);
  }

  @Get('listings')
  @Public()
  async getListings() {
    return this.marketplaceService.getListings();
  }

  @Get(':idOrSlug')
  @Public()
  async getListingDetails(@Param('idOrSlug') idOrSlug: string) {
    return this.marketplaceService.getListingDetails(idOrSlug);
  }

  @Patch('products/:vendorProductId')
  @RequireProfile('VENDOR')
  @UseGuards(RequireProfileGuard)
  async updateListingStatus(
    @Param('vendorProductId') vendorProductId: string,
    @Body('isActive') isActive: boolean,
  ) {
    // Toggles active state of listing
    return this.marketplaceService.updateListingStatus(vendorProductId, isActive);
  }
}
