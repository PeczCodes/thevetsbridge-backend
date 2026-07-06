import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { STORAGE_ADAPTER } from './ports/storage-adapter.interface';
import { FolderResolver } from './resolver/folder.resolver';
import {
  MediaOwnerType,
  MediaResourceType,
  MediaStatus,
  MediaProvider,
  Media,
  UploadIntent,
} from '@prisma/client';
import { randomUUID } from 'crypto';

export interface CreateIntentDto {
  ownerType: MediaOwnerType;
  ownerId: string;
  resourceType: MediaResourceType;
  uploaderId: string;
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly folderResolver: FolderResolver,
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: any,
  ) {}

  async createUploadIntent(dto: CreateIntentDto) {
    const intentId = randomUUID();
    const publicId = `${dto.resourceType.toLowerCase()}_${randomUUID()}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes expiration

    // 1. Pre-create the UploadIntent
    const intent = await this.prisma.uploadIntent.create({
      data: {
        id: intentId,
        ownerType: dto.ownerType,
        ownerId: dto.ownerId,
        resourceType: dto.resourceType,
        uploaderId: dto.uploaderId,
        expiresAt,
        status: MediaStatus.PENDING,
      },
    });

    // 2. Resolve target folder path
    const folder = this.folderResolver.resolve(dto.ownerType, dto.resourceType);

    // 3. Build Cloudinary Context Metadata
    const context = {
      intent_id: intentId,
      owner_type: dto.ownerType,
      owner_id: dto.ownerId,
      resource_type: dto.resourceType,
      uploaded_by: dto.uploaderId,
      application: 'VetzBridge',
      environment: process.env.NODE_ENV || 'development',
    };

    // 4. Generate Pre-signed Cloudinary parameters
    const signatureDetails = await this.storageAdapter.generateUploadSignature(
      publicId,
      folder,
      context,
    );

    return {
      intentId,
      expiresAt,
      ...signatureDetails,
    };
  }

  async completeUpload(intentId: string, publicId: string): Promise<Media> {
    const intent = await this.prisma.uploadIntent.findUnique({
      where: { id: intentId },
    });

    if (!intent) {
      throw new NotFoundException(`UploadIntent ${intentId} not found.`);
    }

    if (intent.status === MediaStatus.READY) {
      // Already processed, return the associated Media
      const existing = await this.prisma.media.findFirst({
        where: { publicId },
      });
      if (existing) return existing;
    }

    // 1. Retrieve the metadata from Cloudinary (Source of Truth for file attributes)
    this.logger.log(`Fetching Cloudinary metadata for publicId: ${publicId}`);
    const metadata = await this.storageAdapter.getAssetMetadata(publicId);

    // 2. Process association and replacement transactionally
    return this.prisma.$transaction(async (tx) => {
      // Find if there is an existing media to replace (to trigger soft-deletes)
      let oldMediaId: string | null = null;

      if (intent.ownerType === MediaOwnerType.USER) {
        const user = await tx.user.findUnique({
          where: { id: intent.ownerId },
          select: { avatarMediaId: true },
        });
        oldMediaId = user?.avatarMediaId || null;
      } else if (intent.ownerType === MediaOwnerType.VET) {
        const vet = await tx.vetProfile.findUnique({
          where: { id: intent.ownerId },
          select: { avatarMediaId: true, licenseDocMediaId: true },
        });
        if (intent.resourceType === MediaResourceType.PROFILE_IMAGE) {
          oldMediaId = vet?.avatarMediaId || null;
        } else if (intent.resourceType === MediaResourceType.LICENSE_DOCUMENT) {
          oldMediaId = vet?.licenseDocMediaId || null;
        }
      } else if (intent.ownerType === MediaOwnerType.VENDOR) {
        const vendor = await tx.vendorProfile.findUnique({
          where: { id: intent.ownerId },
          select: { avatarMediaId: true },
        });
        oldMediaId = vendor?.avatarMediaId || null;
      } else if (intent.ownerType === MediaOwnerType.ANIMAL) {
        const animal = await tx.animal.findUnique({
          where: { id: intent.ownerId },
          select: { photoMediaId: true },
        });
        oldMediaId = animal?.photoMediaId || null;
      } else if (intent.ownerType === MediaOwnerType.CONSULTATION) {
        const attachment = await tx.chatMessageAttachment.findFirst({
          where: { mediaId: intent.id },
        });
        oldMediaId = attachment?.mediaId || null;
      }

      // 3. Create the Media record
      const media = await tx.media.create({
        data: {
          publicId,
          storageUrl: metadata.secureUrl,
          provider: MediaProvider.CLOUDINARY,
          status: MediaStatus.READY,
          ownerType: intent.ownerType,
          ownerId: intent.ownerId,
          resourceType: intent.resourceType,
          bytes: metadata.bytes,
          format: metadata.format,
          width: metadata.width,
          height: metadata.height,
          duration: metadata.duration,
          etag: metadata.etag,
          version: metadata.version,
          uploadedBy: intent.uploaderId,
        },
      });

      // 4. Update the relationship on the domain entity
      if (intent.ownerType === MediaOwnerType.USER) {
        await tx.user.update({
          where: { id: intent.ownerId },
          data: { avatarMediaId: media.id },
        });
      } else if (intent.ownerType === MediaOwnerType.VET) {
        if (intent.resourceType === MediaResourceType.PROFILE_IMAGE) {
          await tx.vetProfile.update({
            where: { id: intent.ownerId },
            data: { avatarMediaId: media.id },
          });
        } else if (intent.resourceType === MediaResourceType.LICENSE_DOCUMENT) {
          await tx.vetProfile.update({
            where: { id: intent.ownerId },
            data: { licenseDocMediaId: media.id },
          });
        }
      } else if (intent.ownerType === MediaOwnerType.VENDOR) {
        await tx.vendorProfile.update({
          where: { id: intent.ownerId },
          data: { avatarMediaId: media.id },
        });
      } else if (intent.ownerType === MediaOwnerType.ANIMAL) {
        await tx.animal.update({
          where: { id: intent.ownerId },
          data: { photoMediaId: media.id },
        });
      }

      // 5. Update UploadIntent status
      await tx.uploadIntent.update({
        where: { id: intent.id },
        data: { status: MediaStatus.READY },
      });

      // 6. If replacement occurred, soft-delete the old media and queue deletion event
      if (oldMediaId) {
        const oldMedia = await tx.media.findUnique({
          where: { id: oldMediaId },
        });
        if (oldMedia && oldMedia.status !== MediaStatus.DELETED) {
          await tx.media.update({
            where: { id: oldMediaId },
            data: {
              status: MediaStatus.DELETED,
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
          this.logger.log(
            `Old media ${oldMediaId} soft deleted and replacement queued.`,
          );
        }
      }

      // 7. Write completion domain event
      await tx.outboxEvent.create({
        data: {
          type: 'MEDIA_UPLOADED',
          payload: {
            mediaId: media.id,
            ownerType: media.ownerType,
            ownerId: media.ownerId,
            resourceType: media.resourceType,
            storageUrl: media.storageUrl,
          },
        },
      });

      return media;
    });
  }

  async softDeleteMedia(mediaId: string): Promise<void> {
    const media = await this.prisma.media.findUnique({
      where: { id: mediaId },
    });

    if (!media) {
      throw new NotFoundException(`Media ${mediaId} not found.`);
    }

    if (media.status === MediaStatus.DELETED) {
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.media.update({
        where: { id: mediaId },
        data: {
          status: MediaStatus.DELETED,
          deletedAt: new Date(),
        },
      });

      await tx.outboxEvent.create({
        data: {
          type: 'MEDIA_DELETED',
          payload: {
            mediaId: media.id,
            publicId: media.publicId,
          },
        },
      });
    });
    this.logger.log(`Media ${mediaId} marked as soft-deleted.`);
  }
}
