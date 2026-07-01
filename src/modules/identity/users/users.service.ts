import { Injectable, BadRequestException, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../infra/prisma/prisma.service';
import { User } from '@prisma/client';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { HashingService } from '../auth/services/hash.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hashingService: HashingService,
  ) {}

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      include: {
        vetProfile: true,
        vendorProfile: true,
      },
    });
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        vetProfile: true,
        vendorProfile: true,
      },
    });
  }

  async updateProfile(id: string, dto: UpdateProfileDto): Promise<User> {
    const data: any = {};

    if (dto.name) {
      const parts = dto.name.trim().split(/\s+/);
      data.firstName = parts[0] || '';
      data.lastName = parts.slice(1).join(' ') || '';
    }

    if (dto.image !== undefined) {
      data.avatarUrl = dto.image;
    }

    if (dto.phone !== undefined) {
      const existing = await this.prisma.user.findFirst({
        where: {
          phone: dto.phone,
          id: { not: id },
        },
      });
      if (existing) {
        throw new BadRequestException('A user with this phone number already exists');
      }
      data.phone = dto.phone;
    }

    if (dto.address) {
      if (dto.address.street !== undefined) data.street = dto.address.street;
      if (dto.address.city !== undefined) data.city = dto.address.city;
      if (dto.address.state !== undefined) data.state = dto.address.state;
      if (dto.address.postalCode !== undefined) data.postalCode = dto.address.postalCode;
      if (dto.address.country !== undefined) data.country = dto.address.country;
    }

    return this.prisma.user.update({
      where: { id },
      data,
      include: {
        vetProfile: true,
        vendorProfile: true,
      },
    });
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!user.passwordHash) {
      throw new BadRequestException('This account does not have a password configured.');
    }
    const isValid = await this.hashingService.verify(user.passwordHash, currentPassword);
    if (!isValid) {
      throw new UnauthorizedException('Invalid current password');
    }

    const newHashed = await this.hashingService.hash(newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHashed },
    });
    return { success: true };
  }

  async setPassword(userId: string, newPassword: string) {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.passwordHash) {
      throw new BadRequestException('Password has already been set. Use the update password flow.');
    }

    const newHashed = await this.hashingService.hash(newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHashed },
    });
    return { success: true };
  }
}
