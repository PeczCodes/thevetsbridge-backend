import { Injectable } from '@nestjs/common';
import { MediaOwnerType, MediaResourceType } from '@prisma/client';

@Injectable()
export class FolderResolver {
  private readonly folderRegistry: Record<MediaOwnerType, Partial<Record<MediaResourceType, string>>> = {
    [MediaOwnerType.USER]: {
      [MediaResourceType.PROFILE_IMAGE]: 'users/profile',
    },
    [MediaOwnerType.VET]: {
      [MediaResourceType.PROFILE_IMAGE]: 'vets/profile',
      [MediaResourceType.LICENSE_DOCUMENT]: 'vets/licenses',
    },
    [MediaOwnerType.VENDOR]: {
      [MediaResourceType.LOGO]: 'vendors/logo',
      [MediaResourceType.BANNER]: 'vendors/banner',
    },
    [MediaOwnerType.PRODUCT]: {
      [MediaResourceType.PRODUCT_IMAGE]: 'products/images',
      [MediaResourceType.PRODUCT_VIDEO]: 'products/videos',
    },
    [MediaOwnerType.ANIMAL]: {
      [MediaResourceType.PROFILE_IMAGE]: 'animals/profile',
      [MediaResourceType.MEDICAL_DOCUMENT]: 'animals/medical',
    },
    [MediaOwnerType.CONSULTATION]: {
      [MediaResourceType.CONSULTATION_IMAGE]: 'consultations/images',
      [MediaResourceType.CONSULTATION_VIDEO]: 'consultations/videos',
    },
    [MediaOwnerType.ORGANIZATION]: {
      [MediaResourceType.LOGO]: 'organizations/logo',
      [MediaResourceType.BANNER]: 'organizations/banner',
    },
  };

  resolve(ownerType: MediaOwnerType, resourceType: MediaResourceType): string {
    const root = 'vetzbridge';
    const folder = this.folderRegistry[ownerType]?.[resourceType] || 'general';
    return `${root}/${folder}`;
  }
}
