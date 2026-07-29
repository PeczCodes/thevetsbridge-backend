import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { HashingService } from '../identity/auth/services/hash.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../../../infra/cache/cache.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hashingService: HashingService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
  ) {}

  async getStats(range?: string) {
    const now = new Date();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const normRange = (range || 'all').toLowerCase().trim();
    let rangeDateFilter: any = null;

    if (normRange === 'today') {
      rangeDateFilter = { gte: todayStart, lte: todayEnd };
    } else if (normRange === '7d') {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      rangeDateFilter = { gte: d };
    } else if (normRange === '30d' || normRange === 'last 30 days') {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      rangeDateFilter = { gte: d };
    }

    const validPaymentStatuses: any[] = ['SUCCEEDED', 'PAID_IN_ESCROW', 'RELEASED'];

    // Payment filter based on range
    const paymentWhereClause: any = {
      status: { in: validPaymentStatuses },
    };
    if (rangeDateFilter) {
      paymentWhereClause.OR = [
        { paidAt: rangeDateFilter },
        { createdAt: rangeDateFilter },
      ];
    }

    // Appointment completed filter based on range
    const completedApptWhere: any = { status: 'COMPLETED' };
    if (rangeDateFilter) {
      completedApptWhere.createdAt = rangeDateFilter;
    }

    // Dynamic Chart Breakdown based on selected range
    const revenueHistoryProms: Promise<{ name: string; revenue: number }>[] = [];

    if (normRange === 'today') {
      // 6 time slots today (4-hour intervals)
      const hours = [0, 4, 8, 12, 16, 20];
      const labels = ['12 AM', '4 AM', '8 AM', '12 PM', '4 PM', '8 PM'];

      for (let i = 0; i < hours.length; i++) {
        const start = new Date(todayStart);
        start.setHours(hours[i], 0, 0, 0);
        const end = new Date(todayStart);
        end.setHours(hours[i] + 3, 59, 59, 999);

        revenueHistoryProms.push(
          this.prisma.payment.aggregate({
            where: {
              status: { in: validPaymentStatuses },
              OR: [
                { paidAt: { gte: start, lte: end } },
                { createdAt: { gte: start, lte: end } },
              ],
            },
            _sum: { amount: true },
          }).then((res) => ({
            name: labels[i],
            revenue: Number(res._sum.amount || 0),
          }))
        );
      }
    } else if (normRange === '7d') {
      // Last 7 days breakdown
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      for (let i = 6; i >= 0; i--) {
        const start = new Date();
        start.setDate(now.getDate() - i);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setHours(23, 59, 59, 999);

        revenueHistoryProms.push(
          this.prisma.payment.aggregate({
            where: {
              status: { in: validPaymentStatuses },
              OR: [
                { paidAt: { gte: start, lte: end } },
                { createdAt: { gte: start, lte: end } },
              ],
            },
            _sum: { amount: true },
          }).then((res) => ({
            name: dayNames[start.getDay()],
            revenue: Number(res._sum.amount || 0),
          }))
        );
      }
    } else if (normRange === '30d' || normRange === 'last 30 days') {
      // 5-week intervals for 30 days
      for (let i = 4; i >= 0; i--) {
        const start = new Date();
        start.setDate(now.getDate() - (i * 6 + 6));
        start.setHours(0, 0, 0, 0);
        const end = new Date();
        end.setDate(now.getDate() - (i * 6));
        end.setHours(23, 59, 59, 999);

        revenueHistoryProms.push(
          this.prisma.payment.aggregate({
            where: {
              status: { in: validPaymentStatuses },
              OR: [
                { paidAt: { gte: start, lte: end } },
                { createdAt: { gte: start, lte: end } },
              ],
            },
            _sum: { amount: true },
          }).then((res) => ({
            name: `W${5 - i}`,
            revenue: Number(res._sum.amount || 0),
          }))
        );
      }
    } else {
      // Default / All: Last 6 months breakdown
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      for (let i = 5; i >= 0; i--) {
        const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);

        revenueHistoryProms.push(
          this.prisma.payment.aggregate({
            where: {
              status: { in: validPaymentStatuses },
              OR: [
                { paidAt: { gte: start, lte: end } },
                { createdAt: { gte: start, lte: end } },
              ],
            },
            _sum: { amount: true },
          }).then((res) => ({
            name: monthNames[start.getMonth()],
            revenue: Number(res._sum.amount || 0),
          }))
        );
      }
    }

    const [
      totalUsers,
      totalCustomers,
      totalVets,
      totalVendors,
      pendingVets,
      pendingVendors,
      totalAppointments,
      pendingAppointments,
      completedAppointments,
      totalMarketplaceItems,
      activeListings,
      totalRevenueSum,
      todayRevenueSum,
      monthlyRevenueSum,
      revenueHistory,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({
        where: {
          AND: [
            {
              OR: [
                { vetProfile: null },
                { vetProfile: { status: { not: 'APPROVED' } } },
              ],
            },
            {
              OR: [
                { vendorProfile: null },
                { vendorProfile: { status: { not: 'APPROVED' } } },
              ],
            },
          ],
        },
      }),
      this.prisma.vetProfile.count({ where: { status: 'APPROVED' } }),
      this.prisma.vendorProfile.count({ where: { status: 'APPROVED' } }),
      this.prisma.vetProfile.count({ where: { status: 'PENDING' } }),
      this.prisma.vendorProfile.count({ where: { status: 'PENDING' } }),
      this.prisma.appointment.count(),
      this.prisma.appointment.count({
        where: { status: { in: ['PENDING', 'CONFIRMED', 'IN_PROGRESS'] } },
      }),
      this.prisma.appointment.count({ where: completedApptWhere }),
      this.prisma.product.count(),
      this.prisma.vendorProduct.count({ where: { isActive: true } }),
      this.prisma.payment.aggregate({
        where: paymentWhereClause,
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: {
          status: { in: validPaymentStatuses },
          OR: [
            { paidAt: { gte: todayStart, lte: todayEnd } },
            { createdAt: { gte: todayStart, lte: todayEnd } },
          ],
        },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: {
          status: { in: validPaymentStatuses },
          OR: [
            { paidAt: { gte: firstDayOfMonth } },
            { createdAt: { gte: firstDayOfMonth } },
          ],
        },
        _sum: { amount: true },
      }),
      Promise.all(revenueHistoryProms),
    ]);

    const commissionSetting = await this.prisma.systemSetting.findUnique({
      where: { key: 'commission_rate' },
    });
    const commissionRate = parseFloat(commissionSetting?.value || '5');

    const totalRevenue = Number(totalRevenueSum._sum.amount || 0);
    const todayRevenue = Number(todayRevenueSum._sum.amount || 0);
    const monthlyRevenue = Number(monthlyRevenueSum._sum.amount || 0);

    const netRevenue = Math.round(totalRevenue * (commissionRate / 100));
    const todayNetRevenue = Math.round(todayRevenue * (commissionRate / 100));
    const monthlyNetRevenue = Math.round(monthlyRevenue * (commissionRate / 100));

    return {
      stats: {
        totalUsers,
        totalCustomers,
        totalVets,
        totalVendors,
        pendingVets,
        pendingVendors,
        totalAppointments,
        pendingAppointments,
        completedAppointments,
        totalMarketplaceItems,
        activeListings,
        totalRevenue,
        netRevenue,
        commissionRate,
        todayRevenue,
        todayNetRevenue,
        monthlyRevenue,
        monthlyNetRevenue,
        revenueHistory,
        range: normRange,
        pendingListings: 0,
        flaggedContent: 0,
        urgentTickets: 0,
      },
    };
  }

  async getPendingVerifications() {
    const vets = await this.prisma.vetProfile.findMany({
      where: { status: 'PENDING' },
      include: { user: true },
    });

    const vendors = await this.prisma.vendorProfile.findMany({
      where: { status: 'PENDING' },
      include: { user: true },
    });

    const verifications = [
      ...vets.map((v) => ({
        id: v.id,
        type: 'vet' as const,
        name: `${v.user.firstName} ${v.user.lastName}`,
        email: v.user.email,
        createdAt: v.createdAt.toISOString(),
        specialization: v.specializations.join(', '),
      })),
      ...vendors.map((v) => ({
        id: v.id,
        type: 'vendor' as const,
        name: `${v.user.firstName} ${v.user.lastName}`,
        email: v.user.email,
        createdAt: v.createdAt.toISOString(),
        businessName: v.businessName,
      })),
    ];

    return { verifications };
  }

  async getRecentTransactions() {
    const payments = await this.prisma.payment.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: { user: true },
    });

    const transactions = payments.map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      status: p.status,
      type: p.purpose,
      userName: `${p.user.firstName} ${p.user.lastName}`,
      createdAt: p.createdAt.toISOString(),
    }));

    return { transactions };
  }

  async getUsers(search?: string, status?: string, page = 1, limit = 100) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (status === 'ACTIVE') {
      where.isActive = true;
    } else if (status === 'SUSPENDED') {
      where.isActive = false;
    }

    return this.prisma.user.findMany({
      where,
      skip,
      take: limit,
      include: {
        vetProfile: true,
        vendorProfile: true,
        _count: {
          select: {
            appointments: true,
            orders: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async suspendUser(userId: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');

      const newActiveState = !user.isActive;

      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: { isActive: newActiveState },
      });

      // Emit outbox event
      await tx.outboxEvent.create({
        data: {
          type: 'USER_STATUS_CHANGED',
          payload: {
            userId: user.id,
            email: user.email,
            isActive: newActiveState,
          },
        },
      });

      return updatedUser;
    });

    await this.cacheService.invalidateUser(userId);
    return updated;
  }

  async resetPassword(userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');

      // Generate a stateless password reset token containing current hash
      const token = this.jwtService.sign(
        {
          sub: user.id,
          email: user.email,
          currentHash: user.passwordHash,
          action: 'reset-password',
        },
        {
          secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
          expiresIn: '1h',
        },
      );

      // Emit outbox event without plaintext password!
      await tx.outboxEvent.create({
        data: {
          type: 'USER_PASSWORD_RESET',
          payload: {
            userId: user.id,
            email: user.email,
            token,
          },
        },
      });

      return {
        success: true,
        message: "Password reset link has been sent to the user's email.",
      };
    });
  }

  async listVets(status?: string) {
    const where: any = {};
    if (status && status !== 'ALL') {
      where.status = status;
    }
    return this.prisma.vetProfile.findMany({
      where,
      include: { user: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async verifyVet(
    vetId: string,
    status: any,
    verified: boolean,
    rejectionReason?: string,
  ) {
    let targetUserId = '';
    const updated = await this.prisma.$transaction(async (tx) => {
      const vet = await tx.vetProfile.findUnique({ where: { id: vetId } });
      if (!vet) throw new NotFoundException('Vet profile not found');
      targetUserId = vet.userId;

      const updatedProfile = await tx.vetProfile.update({
        where: { id: vetId },
        data: {
          status,
          rejectionReason: status === 'REJECTED' ? rejectionReason : null,
        },
      });

      // Write OutboxEvent
      await tx.outboxEvent.create({
        data: {
          type:
            status === 'APPROVED'
              ? 'VET_PROFILE_APPROVED'
              : status === 'REJECTED'
                ? 'VET_PROFILE_REJECTED'
                : 'VET_PROFILE_UPDATED',
          payload: {
            userId: vet.userId,
            vetProfileId: vet.id,
            rejectionReason: status === 'REJECTED' ? rejectionReason : null,
          },
        },
      });

      // Create in-app notification for the vet user
      if (status === 'APPROVED' || status === 'REJECTED') {
        await tx.notification.create({
          data: {
            userId: vet.userId,
            title: status === 'APPROVED' ? 'Vet Profile Approved 🎉' : 'Vet Profile Status Update ⚠️',
            body: status === 'APPROVED'
              ? 'Your veterinarian profile application has been verified and approved. You can now accept patient bookings.'
              : `Your veterinarian profile application requires attention. Reason: ${rejectionReason || 'Verification pending.'}`,
            type: 'SYSTEM',
            data: {
              targetRole: 'VET',
              vetProfileId: vet.id,
            },
          },
        });
      }

      return updatedProfile;
    });

    if (targetUserId) {
      await this.cacheService.invalidateUser(targetUserId);
    }
    return updated;
  }

  async listVendors(status?: string) {
    const where: any = {};
    if (status && status !== 'ALL') {
      where.status = status;
    }
    const vendors = await this.prisma.vendorProfile.findMany({
      where,
      include: {
        user: true,
        _count: {
          select: { products: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return vendors.map((v) => ({
      ...v,
      totalListings: v._count?.products || 0,
    }));
  }

  async verifyVendor(vendorId: string, status: any, rejectionReason?: string) {
    let targetUserId = '';
    const updated = await this.prisma.$transaction(async (tx) => {
      const vendor = await tx.vendorProfile.findUnique({
        where: { id: vendorId },
      });
      if (!vendor) throw new NotFoundException('Vendor profile not found');
      targetUserId = vendor.userId;

      const updatedProfile = await tx.vendorProfile.update({
        where: { id: vendorId },
        data: {
          status,
          rejectionReason: status === 'REJECTED' ? rejectionReason : null,
        },
      });

      // Write OutboxEvent
      await tx.outboxEvent.create({
        data: {
          type:
            status === 'APPROVED'
              ? 'VENDOR_PROFILE_APPROVED'
              : status === 'REJECTED'
                ? 'VENDOR_PROFILE_REJECTED'
                : 'VENDOR_PROFILE_UPDATED',
          payload: {
            userId: vendor.userId,
            vendorProfileId: vendor.id,
            rejectionReason: status === 'REJECTED' ? rejectionReason : null,
          },
        },
      });

      // Create in-app notification for the vendor user
      if (status === 'APPROVED' || status === 'REJECTED') {
        await tx.notification.create({
          data: {
            userId: vendor.userId,
            title: status === 'APPROVED' ? 'Vendor Store Approved 🎉' : 'Vendor Store Status Update ⚠️',
            body: status === 'APPROVED'
              ? 'Your vendor store application has been approved! You can now publish products to the Marketplace.'
              : `Your vendor store application requires attention. Reason: ${rejectionReason || 'Verification pending.'}`,
            type: 'SYSTEM',
            data: {
              targetRole: 'VENDOR',
              vendorProfileId: vendor.id,
            },
          },
        });
      }

      return updatedProfile;
    });

    if (targetUserId) {
      await this.cacheService.invalidateUser(targetUserId);
    }
    return updated;
  }

  async getSettings() {
    const settings = await this.prisma.systemSetting.findMany();
    const settingsMap = settings.reduce(
      (acc, curr) => {
        acc[curr.key] = curr.value;
        return acc;
      },
      {} as Record<string, string>,
    );

    // Default configuration values
    return {
      commission_rate: settingsMap['commission_rate'] || '5',
      minimum_payout: settingsMap['minimum_payout'] || '5000',
      payout_schedule: settingsMap['payout_schedule'] || 'Weekly',
      email_notifications: settingsMap['email_notifications'] || 'true',
      new_user_alerts: settingsMap['new_user_alerts'] || 'true',
      pending_verifications_alerts:
        settingsMap['pending_verifications_alerts'] || 'true',
      flagged_content_alerts: settingsMap['flagged_content_alerts'] || 'true',
      two_factor_auth: settingsMap['two_factor_auth'] || 'true',
      audit_logging: settingsMap['audit_logging'] || 'true',
      user_data_retention: settingsMap['user_data_retention'] || 'Indefinite',
      transaction_data_retention:
        settingsMap['transaction_data_retention'] || '7 years',
      audit_log_retention: settingsMap['audit_log_retention'] || '2 years',
    };
  }

  async updateSettings(body: Record<string, string>) {
    await this.prisma.$transaction(async (tx) => {
      for (const [key, value] of Object.entries(body)) {
        await tx.systemSetting.upsert({
          where: { key },
          create: { key, value: String(value) },
          update: { value: String(value) },
        });
      }
    });
    return { success: true, message: 'Settings updated successfully' };
  }

  async getAnalytics(range: string) {
    const monthsLimit =
      range === '1month'
        ? 1
        : range === '3months'
          ? 3
          : range === '1year'
            ? 12
            : 6;
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - monthsLimit);
    startDate.setDate(1);
    startDate.setHours(0, 0, 0, 0);

    const monthNames = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    const monthlyDataMap: Record<
      string,
      { key: string; month: string; users: number; count: number; amount: number }
    > = {};

    const tempDate = new Date(startDate);
    const currentDate = new Date();
    while (tempDate <= currentDate) {
      const monthStr = monthNames[tempDate.getMonth()];
      const yearStr = String(tempDate.getFullYear()).slice(-2);
      const key = `${tempDate.getFullYear()}-${String(tempDate.getMonth() + 1).padStart(2, '0')}`;
      const label = monthsLimit > 6 ? `${monthStr} '${yearStr}` : monthStr;

      monthlyDataMap[key] = {
        key,
        month: label,
        users: 0,
        count: 0,
        amount: 0,
      };
      tempDate.setMonth(tempDate.getMonth() + 1);
    }

    const successfulStatuses = ['SUCCEEDED', 'PAID_IN_ESCROW', 'RELEASED'];

    // DB aggregations instead of unbounded in-memory loading
    const [
      usersResult,
      appointmentsResult,
      paymentsResult,
      topVetsRaw,
      totalUsers,
      rangePaymentAgg,
      totalConsultations,
      vendorProducts,
    ] = await Promise.all([
      this.prisma.$queryRaw<any[]>`
        SELECT TO_CHAR("createdAt", 'YYYY-MM') AS month_key, COUNT(*)::int AS count
        FROM "User"
        WHERE "createdAt" >= ${startDate}
        GROUP BY TO_CHAR("createdAt", 'YYYY-MM'), DATE_TRUNC('month', "createdAt")
        ORDER BY DATE_TRUNC('month', "createdAt")
      `,
      this.prisma.$queryRaw<any[]>`
        SELECT TO_CHAR("createdAt", 'YYYY-MM') AS month_key, COUNT(*)::int AS count
        FROM "Appointment"
        WHERE "createdAt" >= ${startDate}
        GROUP BY TO_CHAR("createdAt", 'YYYY-MM'), DATE_TRUNC('month', "createdAt")
        ORDER BY DATE_TRUNC('month', "createdAt")
      `,
      this.prisma.$queryRaw<any[]>`
        SELECT TO_CHAR("createdAt", 'YYYY-MM') AS month_key, SUM("amount")::float AS amount
        FROM "Payment"
        WHERE "status"::text IN (${Prisma.join(successfulStatuses)}) AND "createdAt" >= ${startDate}
        GROUP BY TO_CHAR("createdAt", 'YYYY-MM'), DATE_TRUNC('month', "createdAt")
        ORDER BY DATE_TRUNC('month', "createdAt")
      `,
      this.prisma.vetProfile.findMany({
        take: 5,
        include: { user: true },
        orderBy: { totalConsults: 'desc' },
      }),
      this.prisma.user.count(),
      this.prisma.payment.aggregate({
        where: {
          status: { in: successfulStatuses as any },
          createdAt: { gte: startDate },
        },
        _sum: { amount: true },
        _count: { id: true },
      }),
      this.prisma.appointment.count({
        where: { createdAt: { gte: startDate } },
      }),
      this.prisma.vendorProduct.findMany({
        select: { attributes: true },
      }),
    ]);

    // Map DB results to month map
    usersResult.forEach((r) => {
      if (monthlyDataMap[r.month_key]) monthlyDataMap[r.month_key].users = r.count;
    });

    appointmentsResult.forEach((r) => {
      if (monthlyDataMap[r.month_key]) monthlyDataMap[r.month_key].count = r.count;
    });

    paymentsResult.forEach((r) => {
      if (monthlyDataMap[r.month_key]) monthlyDataMap[r.month_key].amount = r.amount || 0;
    });

    const userGrowth = Object.values(monthlyDataMap).map((d) => ({
      month: d.month,
      users: d.users,
    }));
    const consultations = Object.values(monthlyDataMap).map((d) => ({
      month: d.month,
      count: d.count,
    }));
    const revenue = Object.values(monthlyDataMap).map((d) => ({
      month: d.month,
      amount: d.amount,
    }));

    const topVets = topVetsRaw.map((v) => ({
      name: `${v.user.firstName} ${v.user.lastName}`,
      consultations: v.totalConsults,
    }));

    // Dynamic Product Category Distribution from actual marketplace listings
    const CATEGORY_LABELS: Record<string, string> = {
      PET: 'Pets & Animals',
      LIVESTOCK: 'Livestock',
      ACCESSORY: 'Accessories',
      FEED: 'Feeds & Nutrition',
      MEDICATION: 'Medical Supplies',
      EQUIPMENT: 'Equipment & Hardware',
      GROOMING: 'Hygiene & Care',
      TOYS: 'Toys & Play',
      BEDDING: 'Bedding & Housing',
      OTHER: 'Other Products',
    };

    const categoryCounts: Record<string, number> = {};
    vendorProducts.forEach((vp) => {
      const attrs = vp.attributes as any;
      const rawCat = (attrs?.category || 'OTHER').toUpperCase();
      const label = CATEGORY_LABELS[rawCat] || rawCat.replace(/_/g, ' ');
      categoryCounts[label] = (categoryCounts[label] || 0) + 1;
    });

    const categoryDistribution = Object.entries(categoryCounts).map(
      ([category, count]) => ({ category, count }),
    );

    const totalRevenue = Number(rangePaymentAgg._sum.amount || 0);
    const paymentsCountResult = rangePaymentAgg._count.id || 0;
    const averageOrderValue =
      paymentsCountResult === 0 ? 0 : totalRevenue / paymentsCountResult;

    // Growth rates based on current vs previous month in the dataset
    const monthKeys = Object.keys(monthlyDataMap);
    const currentMonthData = monthKeys.length > 0 ? monthlyDataMap[monthKeys[monthKeys.length - 1]] : null;
    const prevMonthData = monthKeys.length > 1 ? monthlyDataMap[monthKeys[monthKeys.length - 2]] : null;

    const thisMonthUsers = currentMonthData?.users || 0;
    const lastMonthUsers = prevMonthData?.users || 0;
    const userGrowthRate =
      lastMonthUsers === 0
        ? thisMonthUsers > 0
          ? 100
          : 0
        : ((thisMonthUsers - lastMonthUsers) / lastMonthUsers) * 100;

    const thisMonthRevenue = currentMonthData?.amount || 0;
    const lastMonthRevenue = prevMonthData?.amount || 0;
    const revenueGrowthRate =
      lastMonthRevenue === 0
        ? thisMonthRevenue > 0
          ? 100
          : 0
        : ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100;

    const thisMonthConsultations = currentMonthData?.count || 0;
    const lastMonthConsultations = prevMonthData?.count || 0;
    const consultationGrowthRate =
      lastMonthConsultations === 0
        ? thisMonthConsultations > 0
          ? 100
          : 0
        : ((thisMonthConsultations - lastMonthConsultations) /
            lastMonthConsultations) *
          100;

    return {
      userGrowth,
      consultations,
      revenue,
      topVets,
      categoryDistribution,
      metrics: {
        totalUsers,
        userGrowthRate,
        totalRevenue,
        revenueGrowthRate,
        totalConsultations,
        consultationGrowthRate,
        averageOrderValue,
      },
    };
  }
}
