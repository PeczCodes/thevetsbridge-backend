import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminGuard } from '../identity/auth/guards/admin.guard';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('stats')
  async getStats(@Query('range') range?: string) {
    return this.adminService.getStats(range);
  }

  @Get('pending-verifications')
  async getPendingVerifications() {
    return this.adminService.getPendingVerifications();
  }

  @Get('recent-transactions')
  async getRecentTransactions() {
    return this.adminService.getRecentTransactions();
  }

  @Get('analytics')
  async getAnalytics(@Query('range') range?: string) {
    return this.adminService.getAnalytics(range || '6months');
  }

  @Get('users')
  async getUsers(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.adminService.getUsers(search, status, page, limit);
  }

  @Post('users/:userId/suspend')
  async suspendUser(@Param('userId') userId: string) {
    return this.adminService.suspendUser(userId);
  }

  @Post('users/:userId/reset-password')
  async resetPassword(@Param('userId') userId: string) {
    return this.adminService.resetPassword(userId);
  }

  @Get('vets')
  async listVets(@Query('status') status?: string) {
    return this.adminService.listVets(status);
  }

  @Patch('vets')
  async verifyVet(
    @Body('vetId') vetId: string,
    @Body('status') status: string,
    @Body('verified') verified: boolean,
    @Body('rejectionReason') rejectionReason?: string,
  ) {
    return this.adminService.verifyVet(
      vetId,
      status,
      verified,
      rejectionReason,
    );
  }

  @Get('vendors')
  async listVendors(@Query('status') status?: string) {
    return this.adminService.listVendors(status);
  }

  @Patch('vendors')
  async verifyVendor(
    @Body('vendorId') vendorId: string,
    @Body('status') status: string,
    @Body('rejectionReason') rejectionReason?: string,
  ) {
    return this.adminService.verifyVendor(vendorId, status, rejectionReason);
  }

  @Get('settings')
  async getSettings() {
    return this.adminService.getSettings();
  }

  @Patch('settings')
  async updateSettings(@Body() body: Record<string, string>) {
    return this.adminService.updateSettings(body);
  }
}
