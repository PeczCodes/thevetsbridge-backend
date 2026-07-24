import { Controller, Get, Patch, Delete, Param, Query } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async getUserNotifications(
    @CurrentUser() user: any,
    @Query('role') role?: string,
  ) {
    return this.notificationsService.getUserNotifications(user.id, role);
  }

  @Patch('mark-all-read')
  async markAllAsRead(
    @CurrentUser() user: any,
    @Query('role') role?: string,
  ) {
    return this.notificationsService.markAllAsRead(user.id, role);
  }

  @Patch(':id/read')
  async markAsRead(
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.notificationsService.markAsRead(user.id, id);
  }

  @Delete(':id')
  async deleteNotification(
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.notificationsService.deleteNotification(user.id, id);
  }
}
