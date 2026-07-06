import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { HashingService } from '../identity/auth/services/hash.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../../../infra/cache/cache.service';

@Injectable()
export class AdminService {
  private flaggedItems = [
    {
      id: 'flagged-1',
      type: 'listing' as const,
      content: 'Extra-Strength Vet Steroids (Promote rapid growth)',
      reporter: 'Dr. Sarah Jenkins',
      reason:
        'Selling regulated prescription steroids without license validation.',
      reportCount: 4,
      status: 'PENDING',
      createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    },
    {
      id: 'flagged-2',
      type: 'review' as const,
      content:
        'This vet is a complete fraud! They charge 10x the normal fee and should be stripped of their license!',
      reporter: 'Anonymous User',
      reason:
        'Contains target harassment and defamatory language without proof.',
      reportCount: 3,
      status: 'PENDING',
      createdAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
    },
    {
      id: 'flagged-3',
      type: 'comment' as const,
      content:
        'Check out my pet shop website at http://spammy-pets.xyz for 90% off all dog foods right now!!!',
      reporter: 'System Bot Filter',
      reason: 'Spam URL link sharing in consultation chat.',
      reportCount: 12,
      status: 'PENDING',
      createdAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    },
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly hashingService: HashingService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
  ) {}

  async getStats() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const firstDayOfMonth = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1,
    );

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
      this.prisma.appointment.count({
        where: {
          status: 'COMPLETED',
          scheduledStart: { gte: todayStart, lte: todayEnd },
        },
      }),
      this.prisma.product.count(),
      this.prisma.vendorProduct.count({ where: { isActive: true } }),
      this.prisma.payment.aggregate({
        where: { status: 'SUCCEEDED' },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: {
          status: 'SUCCEEDED',
          paidAt: { gte: todayStart, lte: todayEnd },
        },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: {
          status: 'SUCCEEDED',
          paidAt: { gte: firstDayOfMonth },
        },
        _sum: { amount: true },
      }),
    ]);

    const totalRevenue = Number(totalRevenueSum._sum.amount || 0);
    const todayRevenue = Number(todayRevenueSum._sum.amount || 0);
    const monthlyRevenue = Number(monthlyRevenueSum._sum.amount || 0);

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
        todayRevenue,
        monthlyRevenue,
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

  async getFlaggedContent() {
    return {
      flaggedItems: this.flaggedItems.filter(
        (item) => item.status === 'PENDING',
      ),
    };
  }

  async resolveFlaggedContent(id: string, action: 'KEEP' | 'DELETE') {
    const item = this.flaggedItems.find((i) => i.id === id);
    if (!item) {
      throw new NotFoundException('Flagged item not found');
    }
    item.status = action === 'KEEP' ? 'RESOLVED_KEEP' : 'RESOLVED_DELETE';
    return {
      success: true,
      message: `Item has been moderated with action: ${action}`,
    };
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
    return this.prisma.vendorProfile.findMany({
      where,
      include: { user: true },
      orderBy: { createdAt: 'desc' },
    });
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
      { month: string; users: number; count: number; amount: number }
    > = {};

    const tempDate = new Date(startDate);
    const currentDate = new Date();
    while (tempDate <= currentDate) {
      const monthStr = monthNames[tempDate.getMonth()];
      monthlyDataMap[monthStr] = {
        month: monthStr,
        users: 0,
        count: 0,
        amount: 0,
      };
      tempDate.setMonth(tempDate.getMonth() + 1);
    }

    // DB aggregations instead of unbounded in-memory loading
    const [
      usersResult,
      appointmentsResult,
      paymentsResult,
      topVetsRaw,
      totalUsers,
      totalRevenueAgg,
      totalConsultations,
      paymentsCountResult,
    ] = await Promise.all([
      this.prisma.$queryRaw<any[]>`
        SELECT TO_CHAR("createdAt", 'Mon') AS month, COUNT(*)::int AS count
        FROM "User"
        WHERE "createdAt" >= ${startDate}
        GROUP BY TO_CHAR("createdAt", 'Mon'), DATE_TRUNC('month', "createdAt")
        ORDER BY DATE_TRUNC('month', "createdAt")
      `,
      this.prisma.$queryRaw<any[]>`
        SELECT TO_CHAR("createdAt", 'Mon') AS month, COUNT(*)::int AS count
        FROM "Appointment"
        WHERE "createdAt" >= ${startDate}
        GROUP BY TO_CHAR("createdAt", 'Mon'), DATE_TRUNC('month', "createdAt")
        ORDER BY DATE_TRUNC('month', "createdAt")
      `,
      this.prisma.$queryRaw<any[]>`
        SELECT TO_CHAR("createdAt", 'Mon') AS month, SUM("amount")::float AS amount
        FROM "Payment"
        WHERE "status" = 'SUCCEEDED' AND "createdAt" >= ${startDate}
        GROUP BY TO_CHAR("createdAt", 'Mon'), DATE_TRUNC('month', "createdAt")
        ORDER BY DATE_TRUNC('month', "createdAt")
      `,
      this.prisma.vetProfile.findMany({
        take: 5,
        include: { user: true },
        orderBy: { totalConsults: 'desc' },
      }),
      this.prisma.user.count(),
      this.prisma.payment.aggregate({
        where: { status: 'SUCCEEDED' },
        _sum: { amount: true },
      }),
      this.prisma.appointment.count(),
      this.prisma.payment.count({
        where: { status: 'SUCCEEDED' },
      }),
    ]);

    // Map DB results to month map
    usersResult.forEach((r) => {
      const mStr = r.month;
      if (monthlyDataMap[mStr]) monthlyDataMap[mStr].users = r.count;
    });

    appointmentsResult.forEach((r) => {
      const mStr = r.month;
      if (monthlyDataMap[mStr]) monthlyDataMap[mStr].count = r.count;
    });

    paymentsResult.forEach((r) => {
      const mStr = r.month;
      if (monthlyDataMap[mStr]) monthlyDataMap[mStr].amount = r.amount || 0;
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

    const categoryDistribution = [
      { category: 'Pet Food & Nutrition', count: 24 },
      { category: 'Medical Supplies', count: 15 },
      { category: 'Accessories', count: 18 },
      { category: 'Hygiene & Care', count: 10 },
      { category: 'Toys & Play', count: 12 },
    ];

    const totalRevenue = Number(totalRevenueAgg._sum.amount || 0);

    const thisMonth = new Date().getMonth();
    const lastMonth = (thisMonth - 1 + 12) % 12;
    const thisMonthStr = monthNames[thisMonth];
    const lastMonthStr = monthNames[lastMonth];

    const thisMonthUsers = monthlyDataMap[thisMonthStr]?.users || 0;
    const lastMonthUsers = monthlyDataMap[lastMonthStr]?.users || 0;
    const userGrowthRate =
      lastMonthUsers === 0
        ? thisMonthUsers > 0
          ? 100
          : 0
        : ((thisMonthUsers - lastMonthUsers) / lastMonthUsers) * 100;

    const thisMonthRevenue = monthlyDataMap[thisMonthStr]?.amount || 0;
    const lastMonthRevenue = monthlyDataMap[lastMonthStr]?.amount || 0;
    const revenueGrowthRate =
      lastMonthRevenue === 0
        ? thisMonthRevenue > 0
          ? 100
          : 0
        : ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100;

    const thisMonthConsultations = monthlyDataMap[thisMonthStr]?.count || 0;
    const lastMonthConsultations = monthlyDataMap[lastMonthStr]?.count || 0;
    const consultationGrowthRate =
      lastMonthConsultations === 0
        ? thisMonthConsultations > 0
          ? 100
          : 0
        : ((thisMonthConsultations - lastMonthConsultations) /
            lastMonthConsultations) *
          100;

    const averageOrderValue =
      paymentsCountResult === 0 ? 0 : totalRevenue / paymentsCountResult;

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
