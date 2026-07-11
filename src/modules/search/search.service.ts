import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { CacheService } from '../../../infra/cache/cache.service';
import { CacheKeys } from '../../../infra/cache/cache-keys';

const PET_KEYWORDS = [
  'dog',
  'cat',
  'puppy',
  'kitten',
  'pet',
  'bird',
  'fish',
  'hamster',
  'rabbit',
  'canine',
  'feline',
  'collar',
  'aquarium',
  'chameleon',
  'guinea',
  'mouse',
  'parrot',
  'canary',
];

const LIVESTOCK_KEYWORDS = [
  'cow',
  'goat',
  'sheep',
  'pig',
  'chicken',
  'poultry',
  'horse',
  'cattle',
  'livestock',
  'farm',
  'bull',
  'lamb',
  'feed',
  'pasture',
  'bullock',
  'hen',
  'rooster',
  'sow',
  'swine',
  'calf',
  'heifer',
];

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  async getRecentOrFeatured() {
    return this.cacheService.getOrSet(
      CacheKeys.searchRecent(),
      async () => {
        const [vets, listings] = await Promise.all([
          this.prisma.vetProfile.findMany({
            where: { status: 'APPROVED', isActive: true },
            take: 4,
            orderBy: { rating: 'desc' },
            include: {
              avatarMedia: true,
              user: {
                include: { avatarMedia: true },
              },
            },
          }),
          this.prisma.vendorProduct.findMany({
            where: {
              isActive: true,
              vendor: { isActive: true },
            },
            take: 6,
            include: { product: true },
          }),
        ]);

        return this.formatResults(vets, listings);
      },
      20 * 60,
    );
  }

  async searchAll(query: string) {
    return this.cacheService.getOrSet(
      CacheKeys.searchQuery(query),
      async () => {
        const [vets, listings] = await Promise.all([
          this.prisma.vetProfile.findMany({
            where: {
              status: 'APPROVED',
              isActive: true,
              OR: [
                { bio: { contains: query, mode: 'insensitive' } },
                { user: { firstName: { contains: query, mode: 'insensitive' } } },
                { user: { lastName: { contains: query, mode: 'insensitive' } } },
              ],
            },
            take: 10,
            include: {
              avatarMedia: true,
              user: {
                include: { avatarMedia: true },
              },
            },
          }),
          this.prisma.vendorProduct.findMany({
            where: {
              isActive: true,
              vendor: { isActive: true },
              OR: [
                { product: { name: { contains: query, mode: 'insensitive' } } },
                {
                  product: {
                    description: { contains: query, mode: 'insensitive' },
                  },
                },
              ],
            },
            take: 10,
            include: { product: true },
          }),
        ]);

        return this.formatResults(vets, listings);
      },
      20 * 60,
    );
  }

  private formatResults(vets: any[], listings: any[]) {
    const formattedVets = vets.map((vet) => ({
      id: vet.id,
      slug: vet.slug,
      name: `Dr. ${vet.user.firstName} ${vet.user.lastName}`,
      category: 'vets',
      rating: vet.rating || 0,
      image: vet.avatarMedia?.storageUrl || vet.user.avatarMedia?.storageUrl || undefined,
      subtitle: vet.specializations[0] || 'GENERAL_PRACTICE',
      consultations: String(vet.totalConsults || 0),
    }));

    const petsProducts: any[] = [];
    const livestockProducts: any[] = [];

    listings.forEach((listing) => {
      const name = listing.product.name.toLowerCase();
      const desc = (listing.product.description || '').toLowerCase();
      const textBlock = `${name} ${desc}`;

      const isLivestock = LIVESTOCK_KEYWORDS.some((kw) =>
        textBlock.includes(kw),
      );

      const images = listing.attributes?.images;
      const imageUrl =
        Array.isArray(images) && images.length > 0 ? images[0] : undefined;

      const formattedProduct = {
        id: listing.id,
        slug: listing.slug,
        name: listing.product.name,
        category: isLivestock ? 'livestock' : 'pets',
        rating: 5.0,
        image: imageUrl,
        subtitle: `₦${Number(listing.price).toLocaleString()}`,
        consultations: '0',
      };

      if (isLivestock) {
        livestockProducts.push(formattedProduct);
      } else {
        petsProducts.push(formattedProduct);
      }
    });

    return {
      vets: formattedVets,
      pets: petsProducts,
      livestock: livestockProducts,
    };
  }
}
