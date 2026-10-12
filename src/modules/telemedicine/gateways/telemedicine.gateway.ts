import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';
import { ConsultationsService } from '../consultations/consultations.service';
import { DirectMessagingService } from '../direct-messaging/direct-messaging.service';
import { UsersService } from '../../identity/users/users.service';

const getOrigins = () => {
  const envOrigins = process.env.CORS_ORIGINS;
  if (envOrigins) {
    return envOrigins.split(',').map((o) => o.trim());
  }
  const frontendUrl = process.env.FRONTEND_URL;
  if (frontendUrl) {
    return [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
      frontendUrl,
    ];
  }
  return [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
  ];
};

@WebSocketGateway({
  namespace: 'telemedicine',
  cors: {
    origin: getOrigins(),
    credentials: true,
  },
})
export class TelemedicineGateway implements OnGatewayConnection {
  private readonly logger = new Logger(TelemedicineGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly consultationsService: ConsultationsService,
    private readonly directMessagingService: DirectMessagingService,
    private readonly usersService: UsersService,
  ) {}

  async handleConnection(socket: Socket) {
    try {
      const authHeader =
        socket.handshake.headers.authorization ||
        socket.handshake.auth?.token ||
        socket.handshake.query?.token;

      let token =
        typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
          ? authHeader.split(' ')[1]
          : authHeader;

      // Fallback: extract accessToken from cookie if not explicitly provided
      if (!token && socket.handshake.headers.cookie) {
        const cookieMap = socket.handshake.headers.cookie
          .split(';')
          .reduce((acc: any, cookie: string) => {
            const [key, value] = cookie.split('=').map((c) => c.trim());
            if (key && value) acc[key] = value;
            return acc;
          }, {});
        token = cookieMap['accessToken'];
      }

      if (!token) {
        this.logger.warn(
          `Connection rejected: missing token on socket ${socket.id}`,
        );
        socket.disconnect(true);
        return;
      }

      // Verify JWT
      const decoded = this.jwtService.verify(token);
      const userId = decoded.sub || decoded.id;

      // Database check to verify user existence and active status
      const user = await this.usersService.findById(userId);
      if (!user || !user.isActive) {
        this.logger.warn(
          `Connection rejected: User ${userId} is suspended or not found`,
        );
        socket.disconnect(true);
        return;
      }

      // Store user payload on the socket instance
      socket.data.user = {
        id: userId,
        email: decoded.email,
        vetProfileId: decoded.vetProfile?.id || user.vetProfile?.id,
      };

      // Subscribe socket to a user-specific room for targeted global emissions
      await socket.join(`user:${userId}`);

      this.logger.log(
        `Client authenticated: ${socket.id} (User: ${socket.data.user.id})`,
      );
    } catch (error) {
      this.logger.warn(
        `Connection rejected: invalid token on socket ${socket.id} - ${error.message}`,
      );
      socket.disconnect(true);
    }
  }

  @SubscribeMessage('join_consultation')
  async handleJoinConsultation(
    @ConnectedSocket() socket: Socket,
    @MessageBody('consultationId') consultationId: string,
  ) {
    const user = socket.data.user;
    if (!user || !consultationId) return;

    try {
      const consultation =
        await this.consultationsService.findConsultationByIdOrAppt(
          consultationId,
          { vet: true },
        );

      if (!consultation) {
        socket.emit('error', 'Consultation not found');
        return;
      }

      const isParticipant =
        consultation.customerId === user.id ||
        consultation.vet?.userId === user.id;

      if (!isParticipant) {
        socket.emit('error', 'Not authorized to join this consultation room');
        return;
      }

      // Always join canonical room by consultation.id
      const roomName = `consultation:${consultation.id}`;
      await socket.join(roomName);
      this.logger.log(`User ${user.id} joined room ${roomName}`);
      socket.emit('joined_room', { room: roomName, consultationId: consultation.id });
    } catch (err) {
      socket.emit('error', 'Failed to join consultation room');
    }
  }

  @SubscribeMessage('send_consultation_message')
  async handleSendConsultationMessage(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { consultationId: string; content: string },
  ) {
    const user = socket.data.user;
    if (!user || !payload?.consultationId || !payload?.content) return;

    try {
      // Send message via service (this enforces status and follow-up expiration checks)
      const message = await this.consultationsService.sendConsultationMessage(
        user.id,
        payload.consultationId,
        payload.content,
      );

      // Always broadcast to canonical consultation room
      const roomName = `consultation:${message.consultationId}`;
      this.server.to(roomName).emit('consultation_message', message);
      this.logger.log(
        `Consultation message sent by ${user.id} in room ${roomName}`,
      );
    } catch (err: any) {
      socket.emit(
        'error',
        err.message || 'Failed to send consultation message',
      );
    }
  }

  @SubscribeMessage('join_direct')
  async handleJoinDirect(
    @ConnectedSocket() socket: Socket,
    @MessageBody('channelId') channelId: string,
  ) {
    const user = socket.data.user;
    if (!user) return;

    try {
      const isParticipant = await this.directMessagingService.isParticipant(
        user.id,
        channelId,
      );
      if (!isParticipant) {
        socket.emit(
          'error',
          'Not authorized to join this direct messaging channel',
        );
        return;
      }

      const roomName = `direct:${channelId}`;
      await socket.join(roomName);
      this.logger.log(`User ${user.id} joined DM room ${roomName}`);
      socket.emit('joined_room', { room: roomName });
    } catch (err) {
      socket.emit('error', 'Failed to join direct messaging room');
    }
  }

  @SubscribeMessage('send_direct_message')
  async handleSendDirectMessage(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { channelId: string; content: string },
  ) {
    const user = socket.data.user;
    if (!user || !payload.channelId || !payload.content) return;

    try {
      const message = await this.directMessagingService.sendDirectMessage(
        user.id,
        payload.channelId,
        payload.content,
      );

      const roomName = `direct:${payload.channelId}`;
      this.server.to(roomName).emit('direct_message', message);
      this.logger.log(`Direct message sent by ${user.id} in room ${roomName}`);
    } catch (err) {
      socket.emit('error', err.message || 'Failed to send direct message');
    }
  }
}
