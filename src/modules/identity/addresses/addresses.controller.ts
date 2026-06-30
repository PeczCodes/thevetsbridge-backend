import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { AddressesService } from './addresses.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('user/addresses')
export class AddressesController {
  constructor(private readonly addressesService: AddressesService) {}

  @Get()
  async findAll(@CurrentUser() user: any) {
    return this.addressesService.findAll(user.id);
  }

  @Get('checkout-default')
  async findDefault(@CurrentUser() user: any) {
    return this.addressesService.findDefault(user.id);
  }

  @Post()
  async create(@CurrentUser() user: any, @Body() dto: CreateAddressDto) {
    return this.addressesService.create(user.id, dto);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.addressesService.update(user.id, id, dto);
  }

  @Delete(':id')
  async delete(@CurrentUser() user: any, @Param('id') id: string) {
    return this.addressesService.delete(user.id, id);
  }

  @Patch(':id/default')
  async setDefault(@CurrentUser() user: any, @Param('id') id: string) {
    return this.addressesService.setDefault(user.id, id);
  }
}
