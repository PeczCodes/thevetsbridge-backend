import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../../infra/prisma/prisma.service';
import { User } from '@prisma/client';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { HashingService } from '../auth/services/hash.service';
import { getOrCreateMediaFromUrl } from '../../../../common/utils/media';
import { CloudinaryService } from '../../../cloudinary/cloudinary.service';
import { CacheService } from '../../../../infra/cache/cache.service';
import { CacheKeys } from '../../../../infra/cache/cache-keys';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hashingService: HashingService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly cacheService: CacheService,
  ) {}

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      include: {
        avatarMedia: true,
        vetProfile: {
          where: { isActive: true },
          include: {
            avatarMedia: true,
            licenseDocMedia: true,
          },
        },
        vendorProfile: {
          where: { isActive: true },
          include: {
            avatarMedia: true,
          },
        },
      },
    });
  }

  async findById(id: string) {
    const key = CacheKeys.authMe(id);
    return this.cacheService.getOrSet(
      key,
      async () => {
        return this.prisma.user.findUnique({
          where: { id },
          include: {
            avatarMedia: true,
            vetProfile: {
              where: { isActive: true },
              include: {
                avatarMedia: true,
                licenseDocMedia: true,
              },
            },
            vendorProfile: {
              where: { isActive: true },
              include: {
                avatarMedia: true,
              },
            },
          },
        });
      },
      60,
    );
  }

  async updateProfile(id: string, dto: UpdateProfileDto): Promise<User> {
    const data: any = {};

    if (dto.name) {
      const parts = dto.name.trim().split(/\s+/);
      data.firstName = parts[0] || '';
      data.lastName = parts.slice(1).join(' ') || '';
    }

    if (dto.timezone !== undefined) {
      data.timezone = dto.timezone;
    }

    if (dto.phone !== undefined) {
      const existing = await this.prisma.user.findFirst({
        where: {
          phone: dto.phone,
          id: { not: id },
        },
      });
      if (existing) {
        throw new BadRequestException(
          'A user with this phone number already exists',
        );
      }
      data.phone = dto.phone;
    }

    if (dto.address) {
      if (dto.address.street !== undefined) data.street = dto.address.street;
      if (dto.address.city !== undefined) data.city = dto.address.city;
      if (dto.address.state !== undefined) data.state = dto.address.state;
      if (dto.address.postalCode !== undefined)
        data.postalCode = dto.address.postalCode;
      if (dto.address.country !== undefined) data.country = dto.address.country;
    }

    let resolvedMedia: any = null;

    const updatedResult = await this.prisma.$transaction(async (tx) => {
      try {
        if (dto.image !== undefined) {
          if (!dto.image || dto.image === '') {
            const user = await tx.user.findUnique({
              where: { id },
              select: { avatarMediaId: true },
            });
            if (user?.avatarMediaId) {
              const oldMedia = await tx.media.findUnique({
                where: { id: user.avatarMediaId },
              });
              if (oldMedia && oldMedia.status !== 'DELETED') {
                await tx.media.update({
                  where: { id: user.avatarMediaId },
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
            data.avatarMediaId = null;
          } else {
            resolvedMedia = await getOrCreateMediaFromUrl(
              tx,
              dto.image,
              'USER',
              id,
              'PROFILE_IMAGE',
              id,
            );
            data.avatarMediaId = resolvedMedia.mediaId;

            // If the user already had an avatar and it changed, soft-delete the old one
            const user = await tx.user.findUnique({
              where: { id },
              select: { avatarMediaId: true },
            });
            if (
              user?.avatarMediaId &&
              user.avatarMediaId !== resolvedMedia.mediaId
            ) {
              const oldMedia = await tx.media.findUnique({
                where: { id: user.avatarMediaId },
              });
              if (oldMedia && oldMedia.status !== 'DELETED') {
                await tx.media.update({
                  where: { id: user.avatarMediaId },
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

        const updatedUser = await tx.user.update({
          where: { id },
          data,
          include: {
            avatarMedia: true,
            vetProfile: true,
            vendorProfile: true,
          },
        });

        const { passwordHash, ...result } = updatedUser;
        return {
          ...result,
          avatarUrl: updatedUser.avatarMedia?.storageUrl || null,
          hasPassword: updatedUser.passwordHash !== null,
        } as any;
      } catch (error) {
        if (resolvedMedia?.isNew && resolvedMedia?.publicId) {
          await this.cloudinaryService.deleteAsset(resolvedMedia.publicId);
        }
        throw error;
      }
    });

    await this.cacheService.invalidateUser(id);
    return updatedResult;
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!user.passwordHash) {
      throw new BadRequestException(
        'This account does not have a password configured.',
      );
    }
    const isValid = await this.hashingService.verify(
      user.passwordHash,
      currentPassword,
    );
    if (!isValid) {
      throw new UnauthorizedException('Invalid current password');
    }

    const newHashed = await this.hashingService.hash(newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHashed },
    });
    await this.cacheService.invalidateUser(userId);
    return { success: true };
  }

  async setPassword(userId: string, newPassword: string) {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.passwordHash) {
      throw new BadRequestException(
        'Password has already been set. Use the update password flow.',
      );
    }

    const newHashed = await this.hashingService.hash(newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHashed },
    });
    await this.cacheService.invalidateUser(userId);
    return { success: true };
  }

  async deleteAccount(userId: string, dto: DeleteAccountDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!user.passwordHash) {
      throw new BadRequestException(
        'This account does not have a password set. Please configure a password in security settings first.',
      );
    }

    const isValid = await this.hashingService.verify(
      user.passwordHash,
      dto.password,
    );
    if (!isValid) {
      throw new UnauthorizedException('Incorrect password');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
    });
    await this.cacheService.invalidateUser(userId);
    return { success: true };
  }

  async deleteVetProfile(userId: string, dto: DeleteAccountDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { vetProfile: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!user.vetProfile) {
      throw new NotFoundException('Vet profile not found');
    }
    if (!user.passwordHash) {
      throw new BadRequestException(
        'This account does not have a password set. Please configure a password in security settings first.',
      );
    }

    const isValid = await this.hashingService.verify(
      user.passwordHash,
      dto.password,
    );
    if (!isValid) {
      throw new UnauthorizedException('Incorrect password');
    }

    await this.prisma.vetProfile.update({
      where: { userId },
      data: { isActive: false },
    });
    await this.cacheService.invalidateUser(userId);
    return { success: true };
  }

  async deleteVendorProfile(userId: string, dto: DeleteAccountDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { vendorProfile: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!user.vendorProfile) {
      throw new NotFoundException('Vendor profile not found');
    }
    if (!user.passwordHash) {
      throw new BadRequestException(
        'This account does not have a password set. Please configure a password in security settings first.',
      );
    }

    const isValid = await this.hashingService.verify(
      user.passwordHash,
      dto.password,
    );
    if (!isValid) {
      throw new UnauthorizedException('Incorrect password');
    }

    await this.prisma.vendorProfile.update({
      where: { userId },
      data: { isActive: false },
    });
    await this.cacheService.invalidateUser(userId);
    return { success: true };
  }
}
