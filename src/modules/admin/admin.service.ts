import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { HashingService } from '../identity/auth/services/hash.service';

@Injectable()
export class AdminService {
  private flaggedItems = [
    {
      id: 'flagged-1',
      type: 'listing' as const,
      content: 'Extra-Strength Vet Steroids (Promote rapid growth)',
      reporter: 'Dr. Sarah Jenkins',
      reason: 'Selling regulated prescription steroids without license validation.',
      reportCount: 4,
      status: 'PENDING',
      createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    },
    {
      id: 'flagged-2',
      type: 'review' as const,
      content: 'This vet is a complete fraud! They charge 10x the normal fee and should be stripped of their license!',
      reporter: 'Anonymous User',
      reason: 'Contains target harassment and defamatory language without proof.',
      reportCount: 3,
      status: 'PENDING',
      createdAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
    },
    {
      id: 'flagged-3',
      type: 'comment' as const,
      content: 'Check out my pet shop website at http://spammy-pets.xyz for 90% off all dog foods right now!!!',
      reporter: 'System Bot Filter',
      reason: 'Spam URL link sharing in consultation chat.',
      reportCount: 12,
      status: 'PENDING',
      createdAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    }
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly hashingService: HashingService,
  ) {}

  async getStats() {
    const totalUsers = await this.prisma.user.count();
    const totalCustomers = await this.prisma.user.count({
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
    });
    const totalVets = await this.prisma.vetProfile.count({ where: { status: 'APPROVED' } });
    const totalVendors = await this.prisma.vendorProfile.count({ where: { status: 'APPROVED' } });
    const pendingVets = await this.prisma.vetProfile.count({ where: { status: 'PENDING' } });
    const pendingVendors = await this.prisma.vendorProfile.count({ where: { status: 'PENDING' } });
    
    const totalAppointments = await this.prisma.appointment.count();
    const pendingAppointments = await this.prisma.appointment.count({
      where: { status: { in: ['PENDING', 'CONFIRMED', 'IN_PROGRESS'] } },
    });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const completedAppointments = await this.prisma.appointment.count({
      where: {
        status: 'COMPLETED',
        scheduledStart: { gte: todayStart, lte: todayEnd },
      },
    });

    const totalMarketplaceItems = await this.prisma.product.count();
    const activeListings = await this.prisma.vendorProduct.count({ where: { isActive: true } });

    // Revenue queries based on Payments
    const totalRevenueSum = await this.prisma.payment.aggregate({
      where: { status: 'SUCCEEDED' },
      _sum: { amount: true },
    });
    const totalRevenue = Number(totalRevenueSum._sum.amount || 0);

    const todayRevenueSum = await this.prisma.payment.aggregate({
      where: {
        status: 'SUCCEEDED',
        paidAt: { gte: todayStart, lte: todayEnd },
      },
      _sum: { amount: true },
    });
    const todayRevenue = Number(todayRevenueSum._sum.amount || 0);

    const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const monthlyRevenueSum = await this.prisma.payment.aggregate({
      where: {
        status: 'SUCCEEDED',
        paidAt: { gte: firstDayOfMonth },
      },
      _sum: { amount: true },
    });
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
        specialization: v.specialization,
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
    return { flaggedItems: this.flaggedItems.filter(item => item.status === 'PENDING') };
  }

  async resolveFlaggedContent(id: string, action: 'KEEP' | 'DELETE') {
    const item = this.flaggedItems.find(i => i.id === id);
    if (!item) {
      throw new NotFoundException('Flagged item not found');
    }
    item.status = action === 'KEEP' ? 'RESOLVED_KEEP' : 'RESOLVED_DELETE';
    return { success: true, message: `Item has been moderated with action: ${action}` };
  }

  async getUsers(search?: string, status?: string) {
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
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');
      
      const newActiveState = !user.isActive;
      
      const updated = await tx.user.update({
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

      return updated;
    });
  }

  async resetPassword(userId: string, bodyPassword?: string) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');
      const passwordToHash = bodyPassword || 'Password123!';
      const passwordHash = await this.hashingService.hash(passwordToHash);
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash },
      });

      // Emit outbox event
      await tx.outboxEvent.create({
        data: {
          type: 'USER_PASSWORD_RESET',
          payload: {
            userId: user.id,
            email: user.email,
            newPassword: passwordToHash,
          },
        },
      });

      return { success: true, message: `Password reset successfully to: ${passwordToHash}` };
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

  async verifyVet(vetId: string, status: any, verified: boolean, rejectionReason?: string) {
    return this.prisma.$transaction(async (tx) => {
      const vet = await tx.vetProfile.findUnique({ where: { id: vetId } });
      if (!vet) throw new NotFoundException('Vet profile not found');
      
      const updated = await tx.vetProfile.update({
        where: { id: vetId },
        data: { 
          status,
          rejectionReason: status === 'REJECTED' ? rejectionReason : null,
        },
      });

      // Write OutboxEvent
      await tx.outboxEvent.create({
        data: {
          type: status === 'APPROVED' ? 'VET_PROFILE_APPROVED' : (status === 'REJECTED' ? 'VET_PROFILE_REJECTED' : 'VET_PROFILE_UPDATED'),
          payload: {
            userId: vet.userId,
            vetProfileId: vet.id,
            rejectionReason: status === 'REJECTED' ? rejectionReason : null,
          },
        },
      });

      return updated;
    });
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
    return this.prisma.$transaction(async (tx) => {
      const vendor = await tx.vendorProfile.findUnique({ where: { id: vendorId } });
      if (!vendor) throw new NotFoundException('Vendor profile not found');
      
      const updated = await tx.vendorProfile.update({
        where: { id: vendorId },
        data: { 
          status,
          rejectionReason: status === 'REJECTED' ? rejectionReason : null,
        },
      });

      // Write OutboxEvent
      await tx.outboxEvent.create({
        data: {
          type: status === 'APPROVED' ? 'VENDOR_PROFILE_APPROVED' : (status === 'REJECTED' ? 'VENDOR_PROFILE_REJECTED' : 'VENDOR_PROFILE_UPDATED'),
          payload: {
            userId: vendor.userId,
            vendorProfileId: vendor.id,
            rejectionReason: status === 'REJECTED' ? rejectionReason : null,
          },
        },
      });

      return updated;
    });
  }

  async getSettings() {
    const settings = await this.prisma.systemSetting.findMany();
    const settingsMap = settings.reduce((acc, curr) => {
      acc[curr.key] = curr.value;
      return acc;
    }, {} as Record<string, string>);

    // Default configuration values
    return {
      commission_rate: settingsMap['commission_rate'] || '5',
      minimum_payout: settingsMap['minimum_payout'] || '5000',
      payout_schedule: settingsMap['payout_schedule'] || 'Weekly',
      email_notifications: settingsMap['email_notifications'] || 'true',
      new_user_alerts: settingsMap['new_user_alerts'] || 'true',
      pending_verifications_alerts: settingsMap['pending_verifications_alerts'] || 'true',
      flagged_content_alerts: settingsMap['flagged_content_alerts'] || 'true',
      two_factor_auth: settingsMap['two_factor_auth'] || 'true',
      audit_logging: settingsMap['audit_logging'] || 'true',
      user_data_retention: settingsMap['user_data_retention'] || 'Indefinite',
      transaction_data_retention: settingsMap['transaction_data_retention'] || '7 years',
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
    const monthsLimit = range === '1month' ? 1 : range === '3months' ? 3 : range === '1year' ? 12 : 6;
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - monthsLimit);
    startDate.setDate(1);
    startDate.setHours(0, 0, 0, 0);

    const users = await this.prisma.user.findMany({
      where: { createdAt: { gte: startDate } },
      select: { createdAt: true },
    });

    const appointments = await this.prisma.appointment.findMany({
      where: { createdAt: { gte: startDate } },
      select: { createdAt: true, status: true },
    });

    const payments = await this.prisma.payment.findMany({
      where: { status: 'SUCCEEDED', createdAt: { gte: startDate } },
      select: { createdAt: true, amount: true },
    });

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthlyDataMap: Record<string, { month: string; users: number; count: number; amount: number }> = {};
    
    const tempDate = new Date(startDate);
    const currentDate = new Date();
    while (tempDate <= currentDate) {
      const monthStr = monthNames[tempDate.getMonth()];
      monthlyDataMap[monthStr] = { month: monthStr, users: 0, count: 0, amount: 0 };
      tempDate.setMonth(tempDate.getMonth() + 1);
    }

    users.forEach(u => {
      const mStr = monthNames[u.createdAt.getMonth()];
      if (monthlyDataMap[mStr]) monthlyDataMap[mStr].users++;
    });

    appointments.forEach(a => {
      const mStr = monthNames[a.createdAt.getMonth()];
      if (monthlyDataMap[mStr]) monthlyDataMap[mStr].count++;
    });

    payments.forEach(p => {
      const mStr = monthNames[p.createdAt.getMonth()];
      if (monthlyDataMap[mStr]) monthlyDataMap[mStr].amount += Number(p.amount);
    });

    const userGrowth = Object.values(monthlyDataMap).map(d => ({ month: d.month, users: d.users }));
    const consultations = Object.values(monthlyDataMap).map(d => ({ month: d.month, count: d.count }));
    const revenue = Object.values(monthlyDataMap).map(d => ({ month: d.month, amount: d.amount }));

    const topVetsRaw = await this.prisma.vetProfile.findMany({
      take: 5,
      include: { user: true },
      orderBy: { totalConsults: 'desc' },
    });
    const topVets = topVetsRaw.map(v => ({
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

    const totalUsers = await this.prisma.user.count();
    const totalRevenue = payments.reduce((acc, p) => acc + Number(p.amount), 0);
    const totalConsultations = appointments.length;

    const thisMonth = new Date().getMonth();
    const lastMonth = (thisMonth - 1 + 12) % 12;
    const thisMonthStr = monthNames[thisMonth];
    const lastMonthStr = monthNames[lastMonth];

    const thisMonthUsers = monthlyDataMap[thisMonthStr]?.users || 0;
    const lastMonthUsers = monthlyDataMap[lastMonthStr]?.users || 0;
    const userGrowthRate = lastMonthUsers === 0 ? (thisMonthUsers > 0 ? 100 : 0) : ((thisMonthUsers - lastMonthUsers) / lastMonthUsers) * 100;

    const thisMonthRevenue = monthlyDataMap[thisMonthStr]?.amount || 0;
    const lastMonthRevenue = monthlyDataMap[lastMonthStr]?.amount || 0;
    const revenueGrowthRate = lastMonthRevenue === 0 ? (thisMonthRevenue > 0 ? 100 : 0) : ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100;

    const thisMonthConsultations = monthlyDataMap[thisMonthStr]?.count || 0;
    const lastMonthConsultations = monthlyDataMap[lastMonthStr]?.count || 0;
    const consultationGrowthRate = lastMonthConsultations === 0 ? (thisMonthConsultations > 0 ? 100 : 0) : ((thisMonthConsultations - lastMonthConsultations) / lastMonthConsultations) * 100;

    const averageOrderValue = payments.length === 0 ? 0 : totalRevenue / payments.length;

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
      }
    };
  }
}
