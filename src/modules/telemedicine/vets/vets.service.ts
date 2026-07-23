import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../../infra/prisma/prisma.service';
import { ConsultationsService } from '../consultations/consultations.service';
import { VetSpecialization } from '@prisma/client';
import { generateSlug, uniqueSlug } from '../../../../common/utils/slug';
import { getOrCreateMediaFromUrl } from '../../../../common/utils/media';
import { CloudinaryService } from '../../../cloudinary/cloudinary.service';
import { CacheService } from '../../../../infra/cache/cache.service';
import { CacheKeys } from '../../../../infra/cache/cache-keys';

@Injectable()
export class VetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly cacheService: CacheService,
  ) {}

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

    const userBalance = await this.prisma.userBalance.findUnique({
      where: { userId: vetProfile.userId },
    });
    let totalEarnings = userBalance ? Number(userBalance.totalEarned) : 0;
    if (totalEarnings === 0 && totalConsults > 0) {
      const commissionSetting = await this.prisma.systemSetting.findUnique({
        where: { key: 'commission_rate' },
      });
      const commissionRate = parseFloat(commissionSetting?.value || '5');
      const commissionFactor = (100 - commissionRate) / 100;

      const completedConsultations = await this.prisma.consultation.findMany({
        where: { vetId: vetProfileId, status: 'COMPLETED' },
        include: { appointment: true },
      });
      totalEarnings = completedConsultations.reduce((sum, c) => {
        const grossFee = Number(vetProfile.consultationFee || 45000);
        return sum + (grossFee * commissionFactor);
      }, 0);
    }

    // Today's earnings (ledger credits)
    const todayEarningsSum = await this.prisma.ledgerEntry.aggregate({
      where: {
        accountId: vetProfile.userId,
        accountType: 'VET_BALANCE',
        type: 'CREDIT',
        createdAt: {
          gte: todayStart,
          lte: todayEnd,
        },
      },
      _sum: {
        amount: true,
      },
    });
    const todayEarnings = todayEarningsSum._sum.amount
      ? Number(todayEarningsSum._sum.amount)
      : 0;

    // Current month boundaries
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const endOfMonth = new Date(
      startOfMonth.getFullYear(),
      startOfMonth.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );

    // Monthly earnings (ledger credits)
    const monthlyEarningsSum = await this.prisma.ledgerEntry.aggregate({
      where: {
        accountId: vetProfile.userId,
        accountType: 'VET_BALANCE',
        type: 'CREDIT',
        createdAt: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
      _sum: {
        amount: true,
      },
    });
    const monthlyEarnings = monthlyEarningsSum._sum.amount
      ? Number(monthlyEarningsSum._sum.amount)
      : 0;

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
      ...vetProfile,
      specialization: vetProfile.specializations[0] || 'GENERAL_PRACTICE',
      user: {
        ...user,
        name: `${user.firstName} ${user.lastName}`,
        image: vetProfile.avatarMedia?.storageUrl || undefined,
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
    // Build a deterministic, sorted fingerprint so that identical filter combos
    // always map to the same cache key, regardless of param order.
    const fingerprintParams: Record<string, string> = {};
    if (specialization) fingerprintParams.specialization = specialization;
    if (minRating) fingerprintParams.minRating = minRating;
    if (maxFee) fingerprintParams.maxFee = maxFee;
    if (availableOnly === 'true') fingerprintParams.availableOnly = 'true';
    if (verifiedOnly === 'true') fingerprintParams.verifiedOnly = 'true';
    // excludeVetProfileId is user-specific — exclude from shared cache key
    const fingerprint = Object.keys(fingerprintParams)
      .sort()
      .map((k) => `${k}=${fingerprintParams[k]}`)
      .join('&');

    return this.cacheService.getOrSet(
      CacheKeys.vetsList(fingerprint),
      async () => {
        const where: any = {
          status: 'APPROVED',
          isActive: true,
          // Exclude the requesting user's own profile so vets don't see themselves in the directory
          ...(excludeVetProfileId && { id: { not: excludeVetProfileId } }),
        };

        if (specialization) {
          where.specializations = { has: specialization as VetSpecialization };
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
            avatarMedia: true,
            user: {
              include: {
                avatarMedia: true,
              },
            },
          },
        });

        const vetIds = vets.map((v) => v.id);
        const completedGroup = await this.prisma.consultation.groupBy({
          by: ['vetId'],
          where: { vetId: { in: vetIds }, status: 'COMPLETED' },
          _count: { _all: true },
        });

        const completedMap = new Map<string, number>();
        completedGroup.forEach((g) => {
          if (g.vetId) completedMap.set(g.vetId, g._count._all);
        });

        return vets.map((vet) => ({
          id: vet.id,
          slug: vet.slug || vet.id,
          specializations: vet.specializations,
          specialization: vet.specializations[0] || 'GENERAL_PRACTICE',
          consultationFee: vet.consultationFee ? Number(vet.consultationFee) : null,
          rating: vet.rating,
          totalConsults: Math.max(vet.totalConsults || 0, completedMap.get(vet.id) || 0),
          verificationStatus: vet.status === verifiedOnly && 'APPROVED',
          isAvailable: vet.isAvailable,
          user: {
            name: `${vet.user.firstName} ${vet.user.lastName}`,
            image: vet.avatarMedia?.storageUrl || null,
          },
        }));
      },
      1200,
    );
  }

  async getVetProfile(idOrSlug: string) {
    return this.cacheService.getOrSet(
      CacheKeys.vetProfile(idOrSlug),
      async () => {
        const vet = await this.prisma.vetProfile.findFirst({
          where: {
            OR: [{ id: idOrSlug }, { slug: idOrSlug }],
            status: 'APPROVED',
            isActive: true,
          },
          include: {
            avatarMedia: true,
            user: {
              include: {
                avatarMedia: true,
              },
            },
            reviews: {
              where: { status: 'PUBLISHED' },
              include: {
                reviewer: {
                  include: {
                    avatarMedia: true,
                  },
                },
              },
              orderBy: { createdAt: 'desc' },
            },
          },
        });

        if (!vet) {
          throw new NotFoundException('Veterinarian profile not found');
        }

        const completedCount = await this.prisma.consultation.count({
          where: { vetId: vet.id, status: 'COMPLETED' },
        });

        return {
          id: vet.id,
          slug: vet.slug || vet.id,
          specializations: vet.specializations,
          specialization: vet.specializations[0] || 'GENERAL_PRACTICE',
          licenseNumber: vet.licenseNumber,
          experience: vet.experience,
          consultationFee: vet.consultationFee ? Number(vet.consultationFee) : 0,
          emergencyFee: vet.emergencyFee ? Number(vet.emergencyFee) : null,
          bio: vet.bio || '',
          qualifications: vet.qualifications,
          languages: vet.languages,
          rating: vet.rating,
          totalConsults: Math.max(vet.totalConsults || 0, completedCount),
          user: {
            name: `${vet.user.firstName} ${vet.user.lastName}`,
            email: vet.user.email,
            image: vet.avatarMedia?.storageUrl || null,
          },
          reviews: vet.reviews.map((r) => ({
            id: r.id,
            rating: r.rating,
            comment: r.comment || '',
            createdAt: r.createdAt.toISOString(),
            user: {
              name: `${r.reviewer.firstName} ${r.reviewer.lastName}`,
              image: r.reviewer.avatarMedia?.storageUrl || null,
            },
          })),
        };
      },
      1200,
    );
  }

  async getMonthAvailability(
    idOrSlug: string,
    yearStr: string,
    monthStr: string,
  ) {
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
        const templates = weeklyAvailability.filter(
          (a) => a.dayOfWeek === dayOfWeek,
        );
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
            if (
              slotHour < currentHour ||
              (slotHour === currentHour && slotMin <= currentMin)
            ) {
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

  async getDailyAvailability(idOrSlug: string, dateStr: string) {
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
        if (
          slotHour < currentHour ||
          (slotHour === currentHour && slotMin <= currentMin)
        ) {
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

    let resolvedMedia: any = null;
    let result: any;

    try {
      result = await this.prisma.$transaction(async (tx) => {
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

        let avatarMediaIdUpdate: any = undefined;
        if (dto.image !== undefined) {
          if (!dto.image || dto.image === '') {
            if (vetProfile.avatarMediaId) {
              const oldMedia = await tx.media.findUnique({
                where: { id: vetProfile.avatarMediaId },
              });
              if (oldMedia && oldMedia.status !== 'DELETED') {
                await tx.media.update({
                  where: { id: vetProfile.avatarMediaId },
                  data: {
                    status: 'DELETED',
                    deletedAt: new Date(),
                  },
                });

                await tx.outboxEvent.create({
                  data: {
                    type: 'MEDIA_DELETED',
                    payload: {
                      mediaId: oldMedia.id,
                      publicId: oldMedia.publicId,
                    },
                  },
                });
              }
            }
            avatarMediaIdUpdate = null;
          } else {
            resolvedMedia = await getOrCreateMediaFromUrl(
              tx,
              dto.image,
              'VET',
              vetProfileId,
              'PROFILE_IMAGE',
              userId,
            );
            avatarMediaIdUpdate = resolvedMedia.mediaId;

            // If the vet already had a profile avatar and it changed, soft-delete the old one
            if (
              vetProfile.avatarMediaId &&
              vetProfile.avatarMediaId !== resolvedMedia.mediaId
            ) {
              const oldMedia = await tx.media.findUnique({
                where: { id: vetProfile.avatarMediaId },
              });
              if (oldMedia && oldMedia.status !== 'DELETED') {
                await tx.media.update({
                  where: { id: vetProfile.avatarMediaId },
                  data: {
                    status: 'DELETED',
                    deletedAt: new Date(),
                  },
                });

                await tx.outboxEvent.create({
                  data: {
                    type: 'MEDIA_DELETED',
                    payload: {
                      mediaId: oldMedia.id,
                      publicId: oldMedia.publicId,
                    },
                  },
                });
              }
            }
          }
        }

        const updatedProfile = await tx.vetProfile.update({
          where: { id: vetProfileId },
          data: {
            specializations: dto.specializations,
            licenseNumber: dto.licenseNumber,
            experience: dto.experience,
            consultationFee: dto.consultationFee,
            emergencyFee: dto.emergencyFee,
            bio: dto.bio,
            qualifications: dto.qualifications,
            languages: dto.languages,
            ...(avatarMediaIdUpdate !== undefined && {
              avatarMediaId: avatarMediaIdUpdate,
            }),
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
    } catch (error) {
      if (resolvedMedia?.isNew && resolvedMedia?.publicId) {
        await this.cloudinaryService.deleteAsset(resolvedMedia.publicId);
      }
      throw error;
    }

    // Invalidate the vet's own profile cache, the shared entity cache,
    // and all directory listing variants (fee, rating, availability filters may change)
    await Promise.all([
      this.cacheService.invalidateVet(userId, vetProfileId),
      this.cacheService.del(CacheKeys.vetProfile(vetProfileId)),
      this.cacheService.del(CacheKeys.vetProfile(result.slug || vetProfileId)),
      this.cacheService.invalidateVetsList(),
    ]);

    return result;
  }

  async getVetAvailability(vetProfileId: string) {
    const availability = await this.prisma.vetAvailability.findMany({
      where: { vetId: vetProfileId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
    return { availability };
  }

  async updateVetAvailability(vetProfileId: string, slots: any[]) {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.vetAvailability.deleteMany({
        where: { vetId: vetProfileId },
      });

      if (slots && slots.length > 0) {
        await tx.vetAvailability.createMany({
          data: slots.map((s) => ({
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

    // Changing availability windows affects the availableOnly filter result — purge all list variants
    await this.cacheService.invalidateVetsList();

    return result;
  }
}
