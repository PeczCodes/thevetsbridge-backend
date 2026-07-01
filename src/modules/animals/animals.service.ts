import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { CreateAnimalDto } from './dto/create-animal.dto';
import { UpdateAnimalDto } from './dto/update-animal.dto';
import { OrganizationsService } from '../organizations/organizations.service';
import { generateSlug, uniqueSlug } from '../../../common/utils/slug';

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
    slug: animal.slug || animal.id,
    ageDisplay,
  };
}

@Injectable()
export class AnimalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  async createAnimal(userId: string, dto: CreateAnimalDto) {
    if (dto.organizationId) {
      // Validate user is member of organization
      const isMember = await this.organizationsService.isMember(userId, dto.organizationId);

      if (!isMember) {
        throw new ForbiddenException('User is not a member of the specified organization');
      }
    }

    if (dto.birthDate && (dto.estimatedAgeMonths !== undefined && dto.estimatedAgeMonths !== null)) {
      throw new BadRequestException('An animal cannot have both an exact birth date and an estimated age simultaneously');
    }

    if (dto.ageType === 'EXACT' && !dto.birthDate) {
      throw new BadRequestException('Birth date is required when ageType is EXACT');
    }
    if (dto.ageType === 'ESTIMATED' && (dto.estimatedAgeMonths === undefined || dto.estimatedAgeMonths === null)) {
      throw new BadRequestException('Estimated age is required when ageType is ESTIMATED');
    }

    const baseSlug = generateSlug(dto.name || 'animal');
    const slug = await uniqueSlug(baseSlug, async (s) => {
      const exists = await this.prisma.animal.findFirst({
        where: { slug: s },
      });
      return !!exists;
    });

    return this.prisma.$transaction(async (tx) => {
      const animal = await tx.animal.create({
        data: {
          name: dto.name,
          slug,
          species: dto.species,
          breed: dto.breed,
          type: dto.type,
          photoUrl: dto.photoUrl,
          sex: dto.sex,
          birthDate: dto.ageType === 'EXACT' && dto.birthDate ? new Date(dto.birthDate) : null,
          estimatedAgeMonths: dto.ageType === 'ESTIMATED' && dto.estimatedAgeMonths !== undefined && dto.estimatedAgeMonths !== null ? dto.estimatedAgeMonths : null,
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
  }

  async getUserAnimals(userId: string) {
    const animals = await this.prisma.animal.findMany({
      where: {
        ownerships: {
          some: {
            userId: userId,
            endDate: null,
          },
        },
      },
      include: {
        organization: true,
      },
    });
    return animals.map((a) => mapAnimal(a));
  }

  async getAnimalById(currentUser: any, idOrSlug: string) {
    const animal = await this.prisma.animal.findFirst({
      where: {
        OR: [
          { id: idOrSlug },
          { slug: idOrSlug },
        ],
      },
      include: {
        organization: true,
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
      throw new ForbiddenException('You do not have permission to view this animal profile');
    }

    return mapAnimal(animal);
  }

  async deleteAnimal(userId: string, idOrSlug: string) {
    const animal = await this.prisma.animal.findFirst({
      where: {
        OR: [
          { id: idOrSlug },
          { slug: idOrSlug },
        ],
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
      await tx.animalOwnership.deleteMany({
        where: { animalId: animal.id },
      });
      const deletedAnimal = await tx.animal.delete({
        where: { id: animal.id },
      });
      return mapAnimal(deletedAnimal);
    });
  }

  async updateAnimal(currentUser: any, idOrSlug: string, dto: UpdateAnimalDto) {
    const animal = await this.prisma.animal.findFirst({
      where: {
        OR: [
          { id: idOrSlug },
          { slug: idOrSlug },
        ],
      },
    });

    if (!animal) {
      throw new NotFoundException('Animal not found');
    }

    const isOwner = await this.isOwner(currentUser.id, animal.id);
    if (!isOwner) {
      throw new ForbiddenException('You do not own this animal');
    }

    if (dto.birthDate && (dto.estimatedAgeMonths !== undefined && dto.estimatedAgeMonths !== null)) {
      throw new BadRequestException('An animal cannot have both an exact birth date and an estimated age simultaneously');
    }

    let slug = animal.slug;
    if (dto.name && dto.name !== animal.name) {
      const baseSlug = generateSlug(dto.name);
      slug = await uniqueSlug(baseSlug, async (s) => {
        const exists = await this.prisma.animal.findFirst({
          where: { slug: s, id: { not: animal.id } },
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
          throw new BadRequestException('Birth date is required when ageType is EXACT');
        }
        birthDateUpdate = new Date(dto.birthDate);
        estimatedAgeMonthsUpdate = null;
      } else if (dto.ageType === 'ESTIMATED') {
        if (dto.estimatedAgeMonths === undefined || dto.estimatedAgeMonths === null) {
          throw new BadRequestException('Estimated age is required when ageType is ESTIMATED');
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
      } else if (dto.estimatedAgeMonths !== undefined && dto.estimatedAgeMonths !== null) {
        estimatedAgeMonthsUpdate = dto.estimatedAgeMonths;
        birthDateUpdate = null;
        ageTypeUpdate = 'ESTIMATED';
      }
    }

    const updatedAnimal = await this.prisma.animal.update({
      where: { id: animal.id },
      data: {
        name: dto.name,
        slug,
        species: dto.species,
        breed: dto.breed,
        type: dto.type,
        photoUrl: dto.photoUrl,
        sex: dto.sex,
        birthDate: birthDateUpdate,
        estimatedAgeMonths: estimatedAgeMonthsUpdate,
        ageType: ageTypeUpdate,
        healthStatus: dto.healthStatus,
        weight: dto.weight,
        medicalNotes: dto.medicalNotes,
      },
    });

    return mapAnimal(updatedAnimal);
  }

  async isOwner(userId: string, idOrSlug: string): Promise<boolean> {
    const animal = await this.prisma.animal.findFirst({
      where: {
        OR: [
          { id: idOrSlug },
          { slug: idOrSlug },
        ],
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
        OR: [
          { id: animalIdOrSlug },
          { slug: animalIdOrSlug },
        ],
      },
    });

    if (!animal) {
      throw new NotFoundException('Animal profile not found');
    }

    const isOwner = await this.isOwner(currentUser.id, animal.id);
    const isVetOrAdmin = currentUser.isAdmin || !!currentUser.vetProfile;

    if (!isOwner && !isVetOrAdmin) {
      throw new ForbiddenException('You do not have permission to manage this animal\'s health logs');
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
        OR: [
          { id: animalIdOrSlug },
          { slug: animalIdOrSlug },
        ],
      },
    });

    if (!animal) {
      throw new NotFoundException('Animal profile not found');
    }

    const isOwner = await this.isOwner(currentUser.id, animal.id);
    const isVetOrAdmin = currentUser.isAdmin || !!currentUser.vetProfile;

    if (!isOwner && !isVetOrAdmin) {
      throw new ForbiddenException('You do not have permission to view this animal\'s health logs');
    }

    return this.prisma.animalHealthLog.findMany({
      where: { animalId: animal.id },
      orderBy: { recordedAt: 'desc' },
    });
  }

  async deleteHealthLog(currentUser: any, animalIdOrSlug: string, logId: string) {
    const animal = await this.prisma.animal.findFirst({
      where: {
        OR: [
          { id: animalIdOrSlug },
          { slug: animalIdOrSlug },
        ],
      },
    });

    if (!animal) {
      throw new NotFoundException('Animal profile not found');
    }

    const isOwner = await this.isOwner(currentUser.id, animal.id);
    const isVetOrAdmin = currentUser.isAdmin || !!currentUser.vetProfile;

    if (!isOwner && !isVetOrAdmin) {
      throw new ForbiddenException('You do not have permission to manage this animal\'s health logs');
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
