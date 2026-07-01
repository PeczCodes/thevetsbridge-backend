import { Injectable, ForbiddenException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../infra/prisma/prisma.service';
import { PaginationDto } from '../../../../common/dto/pagination.dto';

@Injectable()
export class DirectMessagingService {
  private readonly logger = new Logger(DirectMessagingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async isParticipant(userId: string, channelId: string): Promise<boolean> {
    const channel = await this.prisma.directChannel.findUnique({
      where: { id: channelId },
      include: { vet: true },
    });

    if (!channel) return false;

    return channel.customerId === userId || channel.vet.userId === userId;
  }

  async getOrCreateChannel(customerId: string, vetId: string) {
    const existing = await this.prisma.directChannel.findUnique({
      where: {
        customerId_vetId: {
          customerId,
          vetId,
        },
      },
    });

    if (existing) return existing;

    const vet = await this.prisma.vetProfile.findUnique({
      where: { id: vetId },
    });

    if (!vet) {
      throw new NotFoundException('Vet profile not found');
    }

    return this.prisma.directChannel.create({
      data: {
        customerId,
        vetId,
      },
    });
  }

  async sendDirectMessage(senderId: string, channelId: string, content: string) {
    const channel = await this.prisma.directChannel.findUnique({
      where: { id: channelId },
      include: { vet: true },
    });

    if (!channel) {
      throw new NotFoundException('Direct messaging channel not found');
    }

    const isCustomer = channel.customerId === senderId;
    const isVet = channel.vet.userId === senderId;

    if (!isCustomer && !isVet) {
      throw new ForbiddenException('You are not a participant in this channel');
    }

    // Vet must explicitly enable direct messaging
    if (!channel.vet.directMessagingEnabled) {
      throw new ForbiddenException('This vet has disabled direct messaging');
    }

    // Create the message
    return this.prisma.chatMessage.create({
      data: {
        channelId,
        senderId,
        content,
      },
      include: { sender: true },
    });
  }

  async getChannelMessages(userId: string, channelId: string, pagination: PaginationDto) {
    const isParticipant = await this.isParticipant(userId, channelId);
    if (!isParticipant) {
      throw new ForbiddenException('You are not a participant in this channel');
    }

    const { page = 1, limit = 10 } = pagination;
    const skip = (page - 1) * limit;

    return this.prisma.chatMessage.findMany({
      where: { channelId },
      skip,
      take: limit,
      include: { sender: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async toggleDirectMessaging(vetProfileId: string, enabled: boolean, price: number) {
    return this.prisma.vetProfile.update({
      where: { id: vetProfileId },
      data: {
        directMessagingEnabled: enabled,
        directMessagingPrice: price,
      },
    });
  }
}
