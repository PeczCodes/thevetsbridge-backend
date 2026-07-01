import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  BadRequestException,
  ConflictException,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import Redis from 'ioredis';
import { Observable, from, of } from 'rxjs';
import { mergeMap, catchError } from 'rxjs/operators';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { IDEMPOTENT_KEY } from '../decorators/idempotent.decorator';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const isIdempotent = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!isIdempotent) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const idempotencyKey = request.headers['x-idempotency-key'];

    if (!idempotencyKey) {
      throw new BadRequestException('X-Idempotency-Key header is required for this operation');
    }

    // Ensure it's a string/format check if necessary
    if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
      throw new BadRequestException('Invalid X-Idempotency-Key header format');
    }

    const redisKey = `idempotency:${idempotencyKey}`;

    // Try to set key as 'processing' with a 24-hour expiration (86400 seconds)
    // 'NX' flag ensures it only succeeds if key doesn't exist
    const lockAcquired = await this.redis.set(redisKey, 'processing', 'EX', 86400, 'NX');

    if (!lockAcquired) {
      // Key exists; fetch its status
      const val = await this.redis.get(redisKey);

      if (val === 'processing') {
        throw new ConflictException(
          'A request with this idempotency key is already being processed. Please try again shortly.',
        );
      }

      if (val) {
        try {
          const parsed = JSON.parse(val);
          if (parsed && parsed.status === 'completed') {
            // Return cached response immediately
            return of(parsed.body);
          }
        } catch {
          // Fallback if serialization failed: delete invalid key and let execution proceed
          await this.redis.del(redisKey);
        }
      }
    }

    // Proceed with route execution
    return next.handle().pipe(
      mergeMap(async (response) => {
        // Cache successful response
        await this.redis.set(
          redisKey,
          JSON.stringify({ status: 'completed', body: response }),
          'EX',
          86400,
        );
        return response;
      }),
      catchError(async (error) => {
        // Delete key on execution failure to allow retrying
        await this.redis.del(redisKey);
        throw error;
      }),
    );
  }
}
