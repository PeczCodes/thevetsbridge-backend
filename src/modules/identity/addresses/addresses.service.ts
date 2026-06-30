import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: string) {
    return this.prisma.address.findMany({
      where: { userId, deletedAt: null },
      orderBy: [
        { isDefault: 'desc' },
        { createdAt: 'desc' },
      ],
    });
  }

  async findDefault(userId: string) {
    const defaultAddr = await this.prisma.address.findFirst({
      where: { userId, isDefault: true, deletedAt: null },
    });
    if (defaultAddr) {
      return defaultAddr;
    }
    // Fallback to most recently created active address
    return this.prisma.address.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(userId: string, dto: CreateAddressDto) {
    return this.prisma.$transaction(async (tx) => {
      const activeCount = await tx.address.count({
        where: { userId, deletedAt: null },
      });

      const shouldBeDefault = activeCount === 0 || dto.isDefault === true;

      if (shouldBeDefault) {
        // Unset other defaults for this user
        await tx.address.updateMany({
          where: { userId, deletedAt: null },
          data: { isDefault: false },
        });
      }

      return tx.address.create({
        data: {
          userId,
          label: dto.label,
          street1: dto.street1,
          street2: dto.street2,
          city: dto.city,
          state: dto.state,
          country: dto.country,
          postalCode: dto.postalCode,
          isDefault: shouldBeDefault,
        },
      });
    });
  }

  async update(userId: string, id: string, dto: UpdateAddressDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.address.findFirst({
        where: { id, userId, deletedAt: null },
      });

      if (!existing) {
        throw new NotFoundException('Address not found or does not belong to this user');
      }

      if (dto.isDefault === true) {
        // Unset other defaults for this user
        await tx.address.updateMany({
          where: { userId, deletedAt: null },
          data: { isDefault: false },
        });
      }

      return tx.address.update({
        where: { id },
        data: {
          label: dto.label !== undefined ? dto.label : undefined,
          street1: dto.street1 !== undefined ? dto.street1 : undefined,
          street2: dto.street2 !== undefined ? dto.street2 : undefined,
          city: dto.city !== undefined ? dto.city : undefined,
          state: dto.state !== undefined ? dto.state : undefined,
          country: dto.country !== undefined ? dto.country : undefined,
          postalCode: dto.postalCode !== undefined ? dto.postalCode : undefined,
          isDefault: dto.isDefault !== undefined ? dto.isDefault : undefined,
        },
      });
    });
  }

  async delete(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.address.findFirst({
        where: { id, userId, deletedAt: null },
      });

      if (!existing) {
        throw new NotFoundException('Address not found or does not belong to this user');
      }

      // Soft delete the address
      const deletedAddress = await tx.address.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          isDefault: false,
        },
      });

      // If we deleted the default address, set another active address as default
      if (existing.isDefault) {
        const nextDefault = await tx.address.findFirst({
          where: { userId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
        });

        if (nextDefault) {
          await tx.address.update({
            where: { id: nextDefault.id },
            data: { isDefault: true },
          });
        }
      }

      return deletedAddress;
    });
  }

  async setDefault(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.address.findFirst({
        where: { id, userId, deletedAt: null },
      });

      if (!existing) {
        throw new NotFoundException('Address not found or does not belong to this user');
      }

      // Set all other active addresses to isDefault: false
      await tx.address.updateMany({
        where: { userId, deletedAt: null },
        data: { isDefault: false },
      });

      // Set current address to isDefault: true
      return tx.address.update({
        where: { id },
        data: { isDefault: true },
      });
    });
  }
}
