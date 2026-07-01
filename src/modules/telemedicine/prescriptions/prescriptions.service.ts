import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../infra/prisma/prisma.service';
import { IssuePrescriptionDto } from './dto/issue-prescription.dto';

@Injectable()
export class PrescriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async issuePrescription(vetProfileId: string, consultationId: string, dto: IssuePrescriptionDto) {
    // Verify the consultation belongs to the vet
    const consultation = await this.prisma.consultation.findUnique({
      where: { id: consultationId },
    });

    if (!consultation) {
      throw new NotFoundException('Consultation not found');
    }

    if (consultation.vetId !== vetProfileId) {
      throw new ForbiddenException('You can only issue prescriptions for your own consultations');
    }

    return this.prisma.$transaction(async (tx) => {
      const prescription = await tx.prescription.create({
        data: {
          consultationId,
          animalId: dto.animalId,
          vetId: vetProfileId,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          items: {
            create: dto.items.map(item => ({
              name: item.name,
              dosage: item.dosage,
              instructions: item.instructions,
            })),
          },
        },
        include: {
          items: true,
        },
      });

      await tx.outboxEvent.create({
        data: {
          type: 'PRESCRIPTION_ISSUED',
          payload: {
            prescriptionId: prescription.id,
            consultationId,
            animalId: dto.animalId,
            vetId: vetProfileId,
          },
        },
      });

      return prescription;
    });
  }
}
