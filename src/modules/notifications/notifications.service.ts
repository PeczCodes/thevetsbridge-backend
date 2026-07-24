import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserNotifications(userId: string, role?: string) {
    const allNotifications = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const filtered = this.filterNotificationsByRole(allNotifications, role);
    const unreadCount = filtered.filter((n) => !n.isRead).length;

    return {
      notifications: filtered,
      unreadCount,
    };
  }

  private filterNotificationsByRole(notifications: any[], role?: string) {
    if (!role) return notifications;

    const normalizedRole = role.toLowerCase().trim();

    return notifications.filter((n) => {
      const data = (n.data as any) || {};
      const targetRole = (data.targetRole || data.role || '').toLowerCase();

      // 1. Explicit targetRole tag match
      if (targetRole) {
        return targetRole === normalizedRole;
      }

      // 2. Contextual fallback classification if data.targetRole is missing
      const titleBody = (n.title + ' ' + n.body).toLowerCase();

      if (normalizedRole === 'admin') {
        return (
          n.type === 'SYSTEM' ||
          titleBody.includes('vendor application') ||
          titleBody.includes('vet verification') ||
          titleBody.includes('dispute') ||
          titleBody.includes('flagged') ||
          titleBody.includes('admin confirmation') ||
          titleBody.includes('pending admin') ||
          titleBody.includes('platform alert')
        );
      }

      if (normalizedRole === 'vet') {
        return (
          titleBody.includes('client ') ||
          titleBody.includes('patient') ||
          titleBody.includes('requested a consultation') ||
          titleBody.includes('booked with you') ||
          titleBody.includes('consultation fee') ||
          titleBody.includes('earnings credited')
        );
      }

      if (normalizedRole === 'vendor') {
        return (
          titleBody.includes('new order for') ||
          titleBody.includes('your product') ||
          titleBody.includes('store sale') ||
          titleBody.includes('vendor application')
        );
      }

      if (normalizedRole === 'customer') {
        return (
          !titleBody.includes('requested a consultation') &&
          !titleBody.includes('vendor application') &&
          !titleBody.includes('vet verification') &&
          !titleBody.includes('new order for your product')
        );
      }

      return true;
    });
  }

  async markAsRead(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  async markAllAsRead(userId: string, role?: string) {
    if (role) {
      const allNotifications = await this.prisma.notification.findMany({
        where: { userId, isRead: false },
      });
      const filtered = this.filterNotificationsByRole(allNotifications, role);
      const targetIds = filtered.map((n) => n.id);

      if (targetIds.length > 0) {
        return this.prisma.notification.updateMany({
          where: { id: { in: targetIds } },
          data: {
            isRead: true,
            readAt: new Date(),
          },
        });
      }
      return { count: 0 };
    }

    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  async deleteNotification(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    return this.prisma.notification.delete({
      where: { id: notificationId },
    });
  }
}
