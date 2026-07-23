import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { CreateAnimalDto } from './dto/create-animal.dto';
import { UpdateAnimalDto } from './dto/update-animal.dto';
import { OrganizationsService } from '../organizations/organizations.service';
import { generateSlug, uniqueSlug } from '../../../common/utils/slug';
import { getOrCreateMediaFromUrl } from '../../../common/utils/media';
import { CloudinaryService } from '../../cloudinary/cloudinary.service';

export function formatExactAge(birthDate: Date): string {
  const now = new Date();
  let years = now.getFullYear() - birthDate.getFullYear();
  let months = now.getMonth() - birthDate.getMonth();

  if (months < 0) {
    years--;
    months += 12;
  }

  const dayDiff = now.getDate() - birthDate.getDate();
  if (dayDiff < 0) {
    months--;
    if (months < 0) {
      years--;
      months += 12;
    }
  }

  if (years < 0) {
    years = 0;
    months = 0;
  }

  const parts: string[] = [];
  if (years > 0) {
    parts.push(`${years} ${years === 1 ? 'year' : 'years'}`);
  }
  if (months > 0 || (years === 0 && months === 0)) {
    parts.push(`${months} ${months === 1 ? 'month' : 'months'}`);
  }
  return parts.join(' ');
}

export function formatEstimatedAge(months: number): string {
  if (months % 12 === 0) {
    const years = months / 12;
    return `Approx. ${years} ${years === 1 ? 'year' : 'years'}`;
  }
  return `Approx. ${months} ${months === 1 ? 'month' : 'months'}`;
}

export function mapAnimal(animal: any) {
  if (!animal) return null;

  let ageDisplay = 'Not provided';
  if (animal.ageType === 'EXACT' && animal.birthDate) {
    ageDisplay = formatExactAge(new Date(animal.birthDate));
  } else if (
    animal.ageType === 'ESTIMATED' &&
    animal.estimatedAgeMonths !== null &&
    animal.estimatedAgeMonths !== undefined
  ) {
    ageDisplay = formatEstimatedAge(animal.estimatedAgeMonths);
  }

  return {
    ...animal,
    photoUrl: animal.photoMedia?.storageUrl || null,
    slug: animal.slug || animal.id,
    ageDisplay,
  };
}

@Injectable()
export class AnimalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationsService: OrganizationsService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  async createAnimal(userId: string, dto: CreateAnimalDto) {
    if (dto.organizationId) {
      // Validate user is member of organization
      const isMember = await this.organizationsService.isMember(
        userId,
        dto.organizationId,
      );

      if (!isMember) {
        throw new ForbiddenException(
          'User is not a member of the specified organization',
        );
      }
    }

    if (
      dto.birthDate &&
      dto.estimatedAgeMonths !== undefined &&
      dto.estimatedAgeMonths !== null
    ) {
      throw new BadRequestException(
        'An animal cannot have both an exact birth date and an estimated age simultaneously',
      );
    }

    if (dto.ageType === 'EXACT' && !dto.birthDate) {
      throw new BadRequestException(
        'Birth date is required when ageType is EXACT',
      );
    }
    if (
      dto.ageType === 'ESTIMATED' &&
      (dto.estimatedAgeMonths === undefined || dto.estimatedAgeMonths === null)
    ) {
      throw new BadRequestException(
        'Estimated age is required when ageType is ESTIMATED',
      );
    }

    const baseSlug = generateSlug(dto.name || 'animal');
    const slug = await uniqueSlug(baseSlug, async (s) => {
      const exists = await this.prisma.animal.findFirst({
        where: { slug: s, deletedAt: null },
      });
      return !!exists;
    });

    let resolvedMedia: any = null;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const baseAnimal = await tx.animal.create({
          data: {
            name: dto.name,
            slug,
            species: dto.species,
            breed: dto.breed,
            type: dto.type,
            sex: dto.sex,
            birthDate:
              dto.ageType === 'EXACT' && dto.birthDate
                ? new Date(dto.birthDate)
                : null,
            estimatedAgeMonths:
              dto.ageType === 'ESTIMATED' &&
              dto.estimatedAgeMonths !== undefined &&
              dto.estimatedAgeMonths !== null
                ? dto.estimatedAgeMonths
                : null,
            ageType: dto.ageType || null,
            healthStatus: dto.healthStatus,
            weight: dto.weight,
            medicalNotes: dto.medicalNotes,
            ...(dto.organizationId && { organizationId: dto.organizationId }),
            ownerships: {
              create: {
                userId: userId,
                status: 'ACTIVE',
              },
            },
          },
        });

        let photoMediaId: string | null = null;
        if (dto.photoUrl) {
          resolvedMedia = await getOrCreateMediaFromUrl(
            tx,
            dto.photoUrl,
            'ANIMAL',
            baseAnimal.id,
            'PROFILE_IMAGE',
            userId,
          );
          photoMediaId = resolvedMedia.mediaId;
        }

        const animal = await tx.animal.update({
          where: { id: baseAnimal.id },
          data: {
            photoMediaId,
          },
          include: {
            photoMedia: true,
          },
        });

        await tx.outboxEvent.create({
          data: {
            type: 'ANIMAL_REGISTERED',
            payload: {
              animalId: animal.id,
              ownerId: userId,
              organizationId: dto.organizationId,
              type: dto.type,
            },
          },
        });

        return mapAnimal({ ...animal, slug: animal.slug || animal.id });
      });
    } catch (error) {
      if (resolvedMedia?.isNew && resolvedMedia?.publicId) {
        await this.cloudinaryService.deleteAsset(resolvedMedia.publicId);
      }
      throw error;
    }
  }

  async getUserAnimals(userId: string) {
    const animals = await this.prisma.animal.findMany({
      where: {
        deletedAt: null,
        ownerships: {
          some: {
            userId: userId,
            endDate: null,
          },
        },
      },
      include: {
        organization: true,
        photoMedia: true,
      },
    });
    return animals.map((a) => mapAnimal(a));
  }

  async getAnimalById(currentUser: any, idOrSlug: string) {
    const animal = await this.prisma.animal.findFirst({
      where: {
        deletedAt: null,
        OR: [{ id: idOrSlug }, { slug: idOrSlug }],
      },
      include: {
        organization: true,
        photoMedia: true,
        consultations: true,
        prescriptions: true,
        appointments: true,
        medicalRecords: true,
        vaccinations: true,
        healthLogs: {
          orderBy: {
            recordedAt: 'desc',
          },
        },
        ownerships: {
          where: {
            endDate: null,
          },
        },
      },
    });

    if (!animal) {
      throw new NotFoundException('Animal profile not found');
    }

    const isOwner = animal.ownerships.some((o) => o.userId === currentUser.id);
    const isVetOrAdmin = currentUser.isAdmin || !!currentUser.vetProfile;

    if (!isOwner && !isVetOrAdmin) {
      throw new ForbiddenException(
        'You do not have permission to view this animal profile',
      );
    }

    return mapAnimal(animal);
  }

  async deleteAnimal(userId: string, idOrSlug: string) {
    const animal = await this.prisma.animal.findFirst({
      where: {
        deletedAt: null,
        OR: [{ id: idOrSlug }, { slug: idOrSlug }],
      },
    });

    if (!animal) {
      throw new NotFoundException('Animal not found');
    }

    const isOwner = await this.isOwner(userId, animal.id);
    if (!isOwner) {
      throw new ForbiddenException('You do not own this animal');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.animalOwnership.updateMany({
        where: { animalId: animal.id, endDate: null },
        data: { endDate: new Date(), isActive: false },
      });
      const deletedAnimal = await tx.animal.update({
        where: { id: animal.id },
        data: {
          deletedAt: new Date(),
        },
        include: {
          photoMedia: true,
        },
      });
      return mapAnimal(deletedAnimal);
    });
  }

  async updateAnimal(currentUser: any, idOrSlug: string, dto: UpdateAnimalDto) {
    const animal = await this.prisma.animal.findFirst({
      where: {
        deletedAt: null,
        OR: [{ id: idOrSlug }, { slug: idOrSlug }],
      },
    });

    if (!animal) {
      throw new NotFoundException('Animal not found');
    }

    const isOwner = await this.isOwner(currentUser.id, animal.id);
    if (!isOwner) {
      throw new ForbiddenException('You do not own this animal');
    }

    if (
      dto.birthDate &&
      dto.estimatedAgeMonths !== undefined &&
      dto.estimatedAgeMonths !== null
    ) {
      throw new BadRequestException(
        'An animal cannot have both an exact birth date and an estimated age simultaneously',
      );
    }

    let slug = animal.slug;
    if (dto.name && dto.name !== animal.name) {
      const baseSlug = generateSlug(dto.name);
      slug = await uniqueSlug(baseSlug, async (s) => {
        const exists = await this.prisma.animal.findFirst({
          where: { slug: s, id: { not: animal.id }, deletedAt: null },
        });
        return !!exists;
      });
    }

    let birthDateUpdate: any = undefined;
    let estimatedAgeMonthsUpdate: any = undefined;
    let ageTypeUpdate: any = undefined;

    if (dto.ageType !== undefined) {
      ageTypeUpdate = dto.ageType;
      if (dto.ageType === 'EXACT') {
        if (!dto.birthDate) {
          throw new BadRequestException(
            'Birth date is required when ageType is EXACT',
          );
        }
        birthDateUpdate = new Date(dto.birthDate);
        estimatedAgeMonthsUpdate = null;
      } else if (dto.ageType === 'ESTIMATED') {
        if (
          dto.estimatedAgeMonths === undefined ||
          dto.estimatedAgeMonths === null
        ) {
          throw new BadRequestException(
            'Estimated age is required when ageType is ESTIMATED',
          );
        }
        estimatedAgeMonthsUpdate = dto.estimatedAgeMonths;
        birthDateUpdate = null;
      } else if (dto.ageType === null) {
        birthDateUpdate = null;
        estimatedAgeMonthsUpdate = null;
      }
    } else {
      if (dto.birthDate) {
        birthDateUpdate = new Date(dto.birthDate);
        estimatedAgeMonthsUpdate = null;
        ageTypeUpdate = 'EXACT';
      } else if (
        dto.estimatedAgeMonths !== undefined &&
        dto.estimatedAgeMonths !== null
      ) {
        estimatedAgeMonthsUpdate = dto.estimatedAgeMonths;
        birthDateUpdate = null;
        ageTypeUpdate = 'ESTIMATED';
      }
    }

    let resolvedMedia: any = null;

    try {
      return await this.prisma.$transaction(async (tx) => {
        let photoMediaIdUpdate: any = undefined;
        if (dto.photoUrl !== undefined) {
          if (!dto.photoUrl || dto.photoUrl === '') {
            if (animal.photoMediaId) {
              const oldMedia = await tx.media.findUnique({
                where: { id: animal.photoMediaId },
              });
              if (oldMedia && oldMedia.status !== 'DELETED') {
                await tx.media.update({
                  where: { id: animal.photoMediaId },
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
            photoMediaIdUpdate = null;
          } else {
            resolvedMedia = await getOrCreateMediaFromUrl(
              tx,
              dto.photoUrl,
              'ANIMAL',
              animal.id,
              'PROFILE_IMAGE',
              currentUser.id,
            );
            photoMediaIdUpdate = resolvedMedia.mediaId;
          }
        }

        const updatedAnimal = await tx.animal.update({
          where: { id: animal.id },
          data: {
            name: dto.name,
            slug,
            species: dto.species,
            breed: dto.breed,
            type: dto.type,
            ...(photoMediaIdUpdate !== undefined && {
              photoMediaId: photoMediaIdUpdate,
            }),
            sex: dto.sex,
            birthDate: birthDateUpdate,
            estimatedAgeMonths: estimatedAgeMonthsUpdate,
            ageType: ageTypeUpdate,
            healthStatus: dto.healthStatus,
            weight: dto.weight,
            medicalNotes: dto.medicalNotes,
          },
          include: {
            photoMedia: true,
          },
        });

        return mapAnimal(updatedAnimal);
      });
    } catch (error) {
      if (resolvedMedia?.isNew && resolvedMedia?.publicId) {
        await this.cloudinaryService.deleteAsset(resolvedMedia.publicId);
      }
      throw error;
    }
  }

  async isOwner(userId: string, idOrSlug: string): Promise<boolean> {
    const animal = await this.prisma.animal.findFirst({
      where: {
        deletedAt: null,
        OR: [{ id: idOrSlug }, { slug: idOrSlug }],
      },
      include: {
        ownerships: {
          where: {
            userId,
            endDate: null,
          },
        },
      },
    });
    return !!animal && animal.ownerships.length > 0;
  }

  async addHealthLog(currentUser: any, animalIdOrSlug: string, dto: any) {
    const animal = await this.prisma.animal.findFirst({
      where: {
        deletedAt: null,
        OR: [{ id: animalIdOrSlug }, { slug: animalIdOrSlug }],
      },
    });

    if (!animal) {
      throw new NotFoundException('Animal profile not found');
    }

    const isOwner = await this.isOwner(currentUser.id, animal.id);
    const isVetOrAdmin = currentUser.isAdmin || !!currentUser.vetProfile;

    if (!isOwner && !isVetOrAdmin) {
      throw new ForbiddenException(
        "You do not have permission to manage this animal's health logs",
      );
    }

    return this.prisma.animalHealthLog.create({
      data: {
        animalId: animal.id,
        weight: dto.weight,
        temperature: dto.temperature,
        heartRate: dto.heartRate,
        notes: dto.notes,
        recordedBy: currentUser.id,
      },
    });
  }

  async getHealthLogs(currentUser: any, animalIdOrSlug: string) {
    const animal = await this.prisma.animal.findFirst({
      where: {
        deletedAt: null,
        OR: [{ id: animalIdOrSlug }, { slug: animalIdOrSlug }],
      },
    });

    if (!animal) {
      throw new NotFoundException('Animal profile not found');
    }

    const isOwner = await this.isOwner(currentUser.id, animal.id);
    const isVetOrAdmin = currentUser.isAdmin || !!currentUser.vetProfile;

    if (!isOwner && !isVetOrAdmin) {
      throw new ForbiddenException(
        "You do not have permission to view this animal's health logs",
      );
    }

    return this.prisma.animalHealthLog.findMany({
      where: { animalId: animal.id },
      orderBy: { recordedAt: 'desc' },
    });
  }

  async deleteHealthLog(
    currentUser: any,
    animalIdOrSlug: string,
    logId: string,
  ) {
    const animal = await this.prisma.animal.findFirst({
      where: {
        deletedAt: null,
        OR: [{ id: animalIdOrSlug }, { slug: animalIdOrSlug }],
      },
    });

    if (!animal) {
      throw new NotFoundException('Animal profile not found');
    }

    const isOwner = await this.isOwner(currentUser.id, animal.id);
    const isVetOrAdmin = currentUser.isAdmin || !!currentUser.vetProfile;

    if (!isOwner && !isVetOrAdmin) {
      throw new ForbiddenException(
        "You do not have permission to manage this animal's health logs",
      );
    }

    const log = await this.prisma.animalHealthLog.findFirst({
      where: { id: logId, animalId: animal.id },
    });

    if (!log) {
      throw new NotFoundException('Health log not found');
    }

    return this.prisma.animalHealthLog.delete({
      where: { id: logId },
    });
  }
}
