import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AddMemberDto } from '../dto/add-member.dto';

@Injectable()
export class OrganizationMembersService {
  constructor(private readonly prisma: PrismaService) {}

  async addMember(ownerId: string, organizationId: string, dto: AddMemberDto) {
    // Verify ownership
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    if (org.ownerId !== ownerId) {
      throw new ForbiddenException('Only the owner can add members');
    }

    return this.prisma.$transaction(async (tx) => {
      const member = await tx.organizationMember.create({
        data: {
          organizationId,
          userId: dto.userId,
          role: dto.role,
        },
      });

      await tx.outboxEvent.create({
        data: {
          type: 'ORGANIZATION_MEMBER_ADDED',
          payload: {
            organizationId,
            userId: dto.userId,
            role: dto.role,
            addedBy: ownerId,
          },
        },
      });

      return member;
    });
  }
}
