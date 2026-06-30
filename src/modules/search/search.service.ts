import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

const PET_KEYWORDS = [
  'dog', 'cat', 'puppy', 'kitten', 'pet', 'bird', 'fish', 
  'hamster', 'rabbit', 'canine', 'feline', 'collar', 'aquarium', 'chameleon',
  'guinea', 'mouse', 'parrot', 'canary'
];

const LIVESTOCK_KEYWORDS = [
  'cow', 'goat', 'sheep', 'pig', 'chicken', 'poultry', 'horse', 
  'cattle', 'livestock', 'farm', 'bull', 'lamb', 'feed', 'pasture',
  'bullock', 'hen', 'rooster', 'sow', 'swine', 'calf', 'heifer'
];

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async getRecentOrFeatured() {
    const [vets, listings] = await Promise.all([
      this.prisma.vetProfile.findMany({
        where: { status: 'APPROVED' },
        take: 4,
        orderBy: { rating: 'desc' },
        include: { user: true },
      }),
      this.prisma.vendorProduct.findMany({
        take: 6,
        include: { product: true },
      }),
    ]);

    return this.formatResults(vets, listings);
  }

  async searchAll(query: string) {
    const [vets, listings] = await Promise.all([
      this.prisma.vetProfile.findMany({
        where: {
          status: 'APPROVED',
          OR: [
            { bio: { contains: query, mode: 'insensitive' } },
            { user: { firstName: { contains: query, mode: 'insensitive' } } },
            { user: { lastName: { contains: query, mode: 'insensitive' } } },
          ],
        },
        take: 10,
        include: { user: true },
      }),
      this.prisma.vendorProduct.findMany({
        where: {
          OR: [
            { product: { name: { contains: query, mode: 'insensitive' } } },
            { product: { description: { contains: query, mode: 'insensitive' } } },
          ],
        },
        take: 10,
        include: { product: true },
      }),
    ]);

    return this.formatResults(vets, listings);
  }

  private formatResults(vets: any[], listings: any[]) {
    const formattedVets = vets.map((vet) => ({
      id: vet.id,
      name: `Dr. ${vet.user.firstName} ${vet.user.lastName}`,
      category: 'vets',
      rating: vet.rating || 0,
      image: vet.user.avatarUrl || undefined,
      subtitle: vet.specialization,
      consultations: String(vet.totalConsults || 0),
    }));

    const petsProducts: any[] = [];
    const livestockProducts: any[] = [];

    listings.forEach((listing) => {
      const name = listing.product.name.toLowerCase();
      const desc = (listing.product.description || '').toLowerCase();
      const textBlock = `${name} ${desc}`;

      const isLivestock = LIVESTOCK_KEYWORDS.some((kw) => textBlock.includes(kw));

      const formattedProduct = {
        id: listing.id,
        name: listing.product.name,
        category: isLivestock ? 'livestock' : 'pets',
        rating: 5.0,
        image: undefined, // fallback handles this since images aren't stored in DB
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
