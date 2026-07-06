import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createOrganization(userId: string, dto: CreateOrganizationDto) {
    return this.prisma.$transaction(async (tx) => {
      // Create the organization
      const organization = await tx.organization.create({
        data: {
          name: dto.name,
          type: dto.type,
          ownerId: userId,
          members: {
            create: {
              userId: userId,
              role: 'OWNER',
            },
          },
        },
      });

      // Insert the Outbox event
      await tx.outboxEvent.create({
        data: {
          type: 'ORGANIZATION_CREATED',
          payload: {
            organizationId: organization.id,
            ownerId: userId,
            type: dto.type,
          },
        },
      });

      this.logger.log(
        `Created organization ${organization.id} by user ${userId}`,
      );
      return organization;
    });
  }

  async getUserOrganizations(userId: string) {
    return this.prisma.organizationMember.findMany({
      where: { userId },
      include: {
        organization: true,
      },
    });
  }

  async isMember(userId: string, organizationId: string): Promise<boolean> {
    const membership = await this.prisma.organizationMember.findFirst({
      where: {
        userId,
        organizationId,
      },
    });
    return !!membership;
  }
}
