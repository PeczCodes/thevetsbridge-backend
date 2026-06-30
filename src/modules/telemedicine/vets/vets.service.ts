import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ConsultationsService } from '../consultations/consultations.service';
import { VetSpecialization } from '@prisma/client';
import { generateSlug, uniqueSlug } from '../../../core/utils/slug';

@Injectable()
export class VetsService {
  constructor(private readonly prisma: PrismaService) {}

  async getVetStats(vetProfileId: string) {
    const vetProfile = await this.prisma.vetProfile.findUnique({
      where: { id: vetProfileId },
    });
    
    if (!vetProfile) {
      throw new NotFoundException('Vet profile not found');
    }
    
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const todayAppointments = await this.prisma.consultation.count({
      where: {
        vetId: vetProfileId,
        scheduledAt: {
          gte: todayStart,
          lte: todayEnd,
        },
      },
    });

    const totalConsults = await this.prisma.consultation.count({
      where: {
        vetId: vetProfileId,
        status: 'COMPLETED',
      },
    });

    const reviews = await this.prisma.vetReview.aggregate({
      where: {
        vetId: vetProfileId,
        status: 'PUBLISHED',
      },
      _avg: {
        rating: true,
      },
    });
    const averageRating = reviews._avg.rating || vetProfile?.rating || 0;

    const earningsSum = await this.prisma.vetEarning.aggregate({
      where: {
        vetId: vetProfileId,
        status: 'SETTLED',
      },
      _sum: {
        netAmount: true,
      },
    });
    const totalEarnings = earningsSum._sum.netAmount ? Number(earningsSum._sum.netAmount) : 0;



    // Today's earnings
    const todayEarningsSum = await this.prisma.vetEarning.aggregate({
      where: {
        vetId: vetProfileId,
        status: 'SETTLED',
        settledAt: {
          gte: todayStart,
          lte: todayEnd,
        },
      },
      _sum: {
        netAmount: true,
      },
    });
    const todayEarnings = todayEarningsSum._sum.netAmount ? Number(todayEarningsSum._sum.netAmount) : 0;

    // Current month boundaries
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const endOfMonth = new Date(startOfMonth.getFullYear(), startOfMonth.getMonth() + 1, 0, 23, 59, 59, 999);

    // Monthly earnings
    const monthlyEarningsSum = await this.prisma.vetEarning.aggregate({
      where: {
        vetId: vetProfileId,
        status: 'SETTLED',
        settledAt: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
      _sum: {
        netAmount: true,
      },
    });
    const monthlyEarnings = monthlyEarningsSum._sum.netAmount ? Number(monthlyEarningsSum._sum.netAmount) : 0;

    const completedConsultations = await this.prisma.consultation.findMany({
      where: {
        vetId: vetProfileId,
        status: 'COMPLETED',
      },
      select: {
        id: true,
      },
    });
    const completedIds = completedConsultations.map((c) => c.id);

    let reviewsCount = 0;
    if (completedIds.length > 0) {
      reviewsCount = await this.prisma.vetReview.count({
        where: {
          consultationId: { in: completedIds },
        },
      });
    }
    const pendingReviews = completedIds.length - reviewsCount;

    return {
      todayAppointments,
      totalConsults,
      averageRating,
      totalEarnings,
      todayEarnings,
      monthlyEarnings,
      pendingReviews,
    };
  }
  
  
  async getProfile(user) {
    if (!user.vetProfile) {
      throw new ForbiddenException('Vet profile required');
    }
    const { vetProfile, ...userWithoutProfile } = user;

    return {
      profile: {
        ...vetProfile,
        user: {
          ...userWithoutProfile,
          name: `${userWithoutProfile.firstName} ${userWithoutProfile.lastName}`,
          image: vetProfile.avatarUrl || userWithoutProfile.avatarUrl || undefined,
        },
      },
    };
  }

  
  async listVets(
    specialization?: string,
    minRating?: string,
    maxFee?: string,
    availableOnly?: string,
    verifiedOnly?: string,
    excludeVetProfileId?: string,
  ) {
    const where: any = {
      status: 'APPROVED',
      // Exclude the requesting user's own profile so vets don't see themselves in the directory
      ...(excludeVetProfileId && { id: { not: excludeVetProfileId } }),
    };

    if (specialization) {
      where.specialization = specialization as VetSpecialization;
    }

    if (availableOnly === 'true') {
      where.isAvailable = true;
    }

    if (minRating) {
      where.rating = { gte: parseFloat(minRating) };
    }

    if (maxFee) {
      where.consultationFee = { lte: parseFloat(maxFee) };
    }

    const vets = await this.prisma.vetProfile.findMany({
      where,
      include: {
        user: true,
      },
    });

    return vets.map((vet) => ({
      id: vet.id,
      slug: vet.slug || vet.id,
      specialization: vet.specialization,
      consultationFee: vet.consultationFee ? Number(vet.consultationFee) : null,
      rating: vet.rating,
      totalConsults: vet.totalConsults,
      verificationStatus: vet.status === verifiedOnly && 'APPROVED',
      isAvailable: vet.isAvailable,
      user: {
        name: `${vet.user.firstName} ${vet.user.lastName}`,
        image: vet.avatarUrl || vet.user.avatarUrl,
      },
    }));
  }
  
  async getVetProfile(idOrSlug: string){
    const vet = await this.prisma.vetProfile.findFirst({
      where: {
        OR: [{ id: idOrSlug }, { slug: idOrSlug }],
        status: 'APPROVED',
      },
      include: {
        user: true,
        reviews: {
          where: { status: 'PUBLISHED' },
          include: {
            reviewer: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!vet) {
      throw new NotFoundException('Veterinarian profile not found');
    }

    return {
      id: vet.id,
      slug: vet.slug || vet.id,
      specialization: vet.specialization,
      licenseNumber: vet.licenseNumber,
      experience: vet.experience,
      consultationFee: vet.consultationFee ? Number(vet.consultationFee) : 0,
      emergencyFee: vet.emergencyFee ? Number(vet.emergencyFee) : null,
      bio: vet.bio || '',
      qualifications: vet.qualifications,
      languages: vet.languages,
      rating: vet.rating,
      totalConsults: vet.totalConsults,
      user: {
        name: `${vet.user.firstName} ${vet.user.lastName}`,
        email: vet.user.email,
        image: vet.avatarUrl || vet.user.avatarUrl,
      },
      reviews: vet.reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment || '',
        createdAt: r.createdAt.toISOString(),
        user: {
          name: `${r.reviewer.firstName} ${r.reviewer.lastName}`,
          image: r.reviewer.avatarUrl,
        },
      })),
    };
  }
  
  async getMonthAvailability(idOrSlug: string, yearStr: string, monthStr: string){
    const vet = await this.prisma.vetProfile.findFirst({
      where: {
        OR: [{ id: idOrSlug }, { slug: idOrSlug }],
        status: 'APPROVED',
      },
    });

    if (!vet) {
      throw new NotFoundException('Veterinarian profile not found');
    }

    const year = parseInt(yearStr);
    const month = parseInt(monthStr);

    if (isNaN(year) || isNaN(month)) {
      return { blockedDates: [] };
    }

    // Get all timeOff records that overlap with the requested month
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);

    const timeOffList = await this.prisma.vetTimeOff.findMany({
      where: {
        vetId: vet.id,
        startDate: { lte: monthEnd },
        endDate: { gte: monthStart },
      },
    });

    // Get weekly availability templates for this vet
    const weeklyAvailability = await this.prisma.vetAvailability.findMany({
      where: { vetId: vet.id, isActive: true },
    });

    const activeDaysOfWeek = new Set(
      weeklyAvailability.map((a) => a.dayOfWeek),
    );

    // Get booked consultations for the month
    const bookedConsultations = await this.prisma.consultation.findMany({
      where: {
        vetId: vet.id,
        scheduledAt: {
          gte: monthStart,
          lte: monthEnd,
        },
        status: { not: 'CANCELLED' },
      },
      select: {
        scheduledAt: true,
      },
    });

    // Group booked times by local date string YYYY-MM-DD
    const bookedTimesByDate = new Map<string, Set<string>>();
    for (const c of bookedConsultations) {
      if (!c.scheduledAt) continue;
      const d = c.scheduledAt;
      const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const hours = d.getHours();
      const minutes = d.getMinutes();
      const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

      if (!bookedTimesByDate.has(dateKey)) {
        bookedTimesByDate.set(dateKey, new Set());
      }
      bookedTimesByDate.get(dateKey)!.add(timeStr);
    }

    const blockedDates: string[] = [];
    const numDays = monthEnd.getDate();
    const now = new Date();
    const formattedToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    for (let day = 1; day <= numDays; day++) {
      const date = new Date(year, month - 1, day);
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      // Check if date falls in timeOff range
      const isTimeOff = timeOffList.some(
        (to) => date >= to.startDate && date <= to.endDate,
      );

      // Check if dayOfWeek is available
      const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, etc.
      const isDayAvailable = activeDaysOfWeek.has(dayOfWeek);

      let availableSlotsCount = 0;
      if (isDayAvailable && !isTimeOff) {
        const templates = weeklyAvailability.filter((a) => a.dayOfWeek === dayOfWeek);
        const rawSlots: string[] = [];
        for (const temp of templates) {
          const startHour = parseInt(temp.startTime.split(':')[0]);
          const endHour = parseInt(temp.endTime.split(':')[0]);

          for (let hour = startHour; hour < endHour; hour++) {
            rawSlots.push(`${String(hour).padStart(2, '0')}:00`);
          }
        }

        const bookedSet = bookedTimesByDate.get(dateStr) || new Set<string>();
        const isToday = dateStr === formattedToday;

        availableSlotsCount = rawSlots.filter((slot) => {
          if (bookedSet.has(slot)) return false;
          if (isToday) {
            const [slotHour, slotMin] = slot.split(':').map(Number);
            const currentHour = now.getHours();
            const currentMin = now.getMinutes();
            if (slotHour < currentHour || (slotHour === currentHour && slotMin <= currentMin)) {
              return false;
            }
          }
          return true;
        }).length;
      }

      if (isTimeOff || !isDayAvailable || availableSlotsCount === 0) {
        blockedDates.push(dateStr);
      }
    }

    return { blockedDates };
  }
  
  async getDailyAvailability(idOrSlug: string, dateStr: string){
    const vet = await this.prisma.vetProfile.findFirst({
      where: {
        OR: [{ id: idOrSlug }, { slug: idOrSlug }],
        status: 'APPROVED',
      },
    });

    if (!vet) {
      throw new NotFoundException('Veterinarian profile not found');
    }

    if (!dateStr) {
      return { slots: [] };
    }

    const queryDate = new Date(dateStr);
    const dayOfWeek = queryDate.getDay();

    // Check if the date is in a timeOff range
    const timeOff = await this.prisma.vetTimeOff.findFirst({
      where: {
        vetId: vet.id,
        startDate: { lte: queryDate },
        endDate: { gte: queryDate },
      },
    });

    if (timeOff) {
      return { slots: [] };
    }

    // Get weekly templates for this day of week
    const templates = await this.prisma.vetAvailability.findMany({
      where: {
        vetId: vet.id,
        dayOfWeek,
        isActive: true,
      },
    });

    if (templates.length === 0) {
      return { slots: [] };
    }

    // Generate potential slots from templates (e.g. hourly slots)
    const rawSlots: string[] = [];
    for (const temp of templates) {
      const startHour = parseInt(temp.startTime.split(':')[0]);
      const endHour = parseInt(temp.endTime.split(':')[0]);

      for (let hour = startHour; hour < endHour; hour++) {
        rawSlots.push(`${String(hour).padStart(2, '0')}:00`);
      }
    }

    // Get booked consultations on this date
    const startOfDay = new Date(queryDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(queryDate);
    endOfDay.setHours(23, 59, 59, 999);

    const bookedConsultations = await this.prisma.consultation.findMany({
      where: {
        vetId: vet.id,
        scheduledAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
        status: { not: 'CANCELLED' },
      },
      select: {
        scheduledAt: true,
      },
    });

    // Exclude slots that match booked consultations
    const bookedTimes = new Set(
      bookedConsultations
        .filter((c) => c.scheduledAt !== null)
        .map((c) => {
          const hours = c.scheduledAt!.getHours();
          const minutes = c.scheduledAt!.getMinutes();
          return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
        }),
    );

    const now = new Date();
    const formattedNow = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const isToday = dateStr === formattedNow;

    const availableSlots = rawSlots.filter((slot) => {
      if (bookedTimes.has(slot)) return false;
      if (isToday) {
        const [slotHour, slotMin] = slot.split(':').map(Number);
        const currentHour = now.getHours();
        const currentMin = now.getMinutes();
        if (slotHour < currentHour || (slotHour === currentHour && slotMin <= currentMin)) {
          return false;
        }
      }
      return true;
    });

    return { slots: availableSlots };
  }
  
  async updateVetProfile(vetProfileId: string, userId: string, dto: any) {
    const vetProfile = await this.prisma.vetProfile.findUnique({
      where: { id: vetProfileId },
      include: { user: true },
    });

    if (!vetProfile) {
      throw new NotFoundException('Vet profile not found');
    }

    if (vetProfile.status === 'PENDING' || vetProfile.status === 'SUSPENDED') {
      throw new ForbiddenException('Profile is locked for editing');
    }

    const newStatus =
      vetProfile.status === 'REJECTED' ? 'PENDING' : vetProfile.status;

    return this.prisma.$transaction(async (tx) => {
      let firstName: string | undefined;
      let lastName: string | undefined;
      if (dto.name) {
        const parts = dto.name.trim().split(/\s+/);
        firstName = parts[0] || '';
        lastName = parts.slice(1).join(' ') || '';
      }

      await tx.user.update({
        where: { id: userId },
        data: {
          ...(firstName !== undefined && { firstName }),
          ...(lastName !== undefined && { lastName }),
        },
      });

      // Regenerate slug if the name changed or the profile has no slug yet
      let slug = vetProfile.slug;
      const effectiveFirstName = firstName ?? vetProfile.user.firstName;
      const effectiveLastName = lastName ?? vetProfile.user.lastName;
      const newName = `${effectiveFirstName} ${effectiveLastName}`;
      const existingSlugName = `${vetProfile.user.firstName} ${vetProfile.user.lastName}`;

      if (!slug || newName !== existingSlugName) {
        const baseSlug = generateSlug(newName);
        slug = await uniqueSlug(baseSlug, async (s) => {
          const existing = await tx.vetProfile.findFirst({
            where: { slug: s, id: { not: vetProfileId } },
          });
          return !!existing;
        });
      }

      const updatedProfile = await tx.vetProfile.update({
        where: { id: vetProfileId },
        data: {
          specialization: dto.specialization,
          licenseNumber: dto.licenseNumber,
          experience: dto.experience,
          consultationFee: dto.consultationFee,
          emergencyFee: dto.emergencyFee,
          bio: dto.bio,
          qualifications: dto.qualifications,
          languages: dto.languages,
          avatarUrl: dto.image,
          status: newStatus,
          rejectionReason: newStatus === 'PENDING' ? null : undefined,
          slug,
        },
      });

      if (vetProfile.status === 'REJECTED' && newStatus === 'PENDING') {
        await tx.outboxEvent.create({
          data: {
            type: 'VET_PROFILE_RESUBMITTED',
            payload: {
              userId,
              vetProfileId,
            },
          },
        });
      }

      return { ...updatedProfile, slug };
    });
  }

  async getVetAvailability(vetProfileId: string) {
    const availability = await this.prisma.vetAvailability.findMany({
      where: { vetId: vetProfileId },
      orderBy: [
        { dayOfWeek: 'asc' },
        { startTime: 'asc' }
      ]
    });
    return { availability };
  }

  async updateVetAvailability(vetProfileId: string, slots: any[]) {
    return this.prisma.$transaction(async (tx) => {
      await tx.vetAvailability.deleteMany({
        where: { vetId: vetProfileId },
      });
      
      if (slots && slots.length > 0) {
        await tx.vetAvailability.createMany({
          data: slots.map(s => ({
            vetId: vetProfileId,
            dayOfWeek: s.dayOfWeek,
            startTime: s.startTime,
            endTime: s.endTime,
            isActive: s.isActive ?? true,
          })),
        });
      }
      
      return { success: true };
    });
  }
}
