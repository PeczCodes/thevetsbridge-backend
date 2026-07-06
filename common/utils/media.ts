import * as crypto from 'crypto';
import { randomUUID } from 'crypto';

export function extractCloudinaryPublicId(url: string): string | null {
  try {
    const match = url.match(/\/upload\/(?:v\d+\/)?(.+?)(\.\w+)?$/);
    if (!match) return null;
    return match[1];
  } catch {
    return null;
  }
}

export interface ResolvedMediaResult {
  mediaId: string;
  isNew: boolean;
  publicId: string | null;
}

/**
 * Checks if a URL is already present in the database as a Media record.
 * If not, creates the Media record.
 * Returns the Media ID, whether it is new, and its parsed public ID (if applicable).
 */
export async function getOrCreateMediaFromUrl(
  prisma: any,
  url: string,
  ownerType: string,
  ownerId: string,
  resourceType: string,
  uploadedBy: string,
): Promise<ResolvedMediaResult> {
  if (!url || typeof url !== 'string') {
    throw new Error('Image URL is required');
  }

  const publicId = extractCloudinaryPublicId(url);

  // Check if a Media record already exists for this URL or public ID
  const existing = await prisma.media.findFirst({
    where: {
      OR: [
        ...(publicId ? [{ publicId }] : []),
        { storageUrl: url },
      ],
      status: { not: 'DELETED' },
    },
  });

  if (existing) {
    return {
      mediaId: existing.id,
      isNew: false,
      publicId: existing.publicId,
    };
  }

  // Create new Media record
  const finalPublicId = publicId || `external_${randomUUID()}`;
  const provider = publicId ? 'CLOUDINARY' : 'EXTERNAL';

  const newMedia = await prisma.media.create({
    data: {
      publicId: finalPublicId,
      storageUrl: url,
      provider,
      status: 'READY',
      ownerType,
      ownerId,
      resourceType,
      uploadedBy,
    },
  });

  return {
    mediaId: newMedia.id,
    isNew: true,
    publicId: publicId, // Only return the real Cloudinary publicId so we delete only Cloudinary-hosted assets
  };
}
