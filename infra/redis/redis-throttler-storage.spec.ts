import { RedisThrottlerStorage } from './redis-throttler-storage';
import { RedisService } from './redis.service';

describe('RedisThrottlerStorage', () => {
  let storage: RedisThrottlerStorage;
  let redisService: jest.Mocked<RedisService>;
  let mockRedisClient: any;

  beforeEach(() => {
    mockRedisClient = {
      eval: jest.fn(),
    };

    redisService = {
      isAvailable: jest.fn().mockReturnValue(true),
      getClient: jest.fn().mockReturnValue(mockRedisClient),
    } as any;

    storage = new RedisThrottlerStorage(redisService);
  });

  it('should call redis eval with correct keys, ttl, limit, and block duration', async () => {
    mockRedisClient.eval.mockResolvedValue([3, 50, 0, 0]);

    const result = await storage.increment('test-key', 60000, 5, 0, 'default');

    expect(redisService.getClient).toHaveBeenCalled();
    expect(mockRedisClient.eval).toHaveBeenCalledWith(
      expect.any(String), // lua script
      2,
      'throttler:test-key:default:count',
      'throttler:test-key:default:blocked',
      60, // ttlSeconds
      5, // limit
      0, // blockSeconds (0 passed safely)
    );

    expect(result).toEqual({
      totalHits: 3,
      timeToExpire: 50,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  });

  it('should correctly parse blocked status when limit is exceeded', async () => {
    mockRedisClient.eval.mockResolvedValue([6, 45, 1, 45]);

    const result = await storage.increment('test-key', 60000, 5, 0, 'default');

    expect(result).toEqual({
      totalHits: 6,
      timeToExpire: 45,
      isBlocked: true,
      timeToBlockExpire: 45,
    });
  });

  it('should fail open when Redis is unavailable', async () => {
    redisService.isAvailable.mockReturnValue(false);

    const result = await storage.increment('test-key', 60000, 5, 0, 'default');

    expect(result).toEqual({
      totalHits: 1,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    expect(mockRedisClient.eval).not.toHaveBeenCalled();
  });

  it('should fail open when Redis eval throws an error', async () => {
    mockRedisClient.eval.mockRejectedValue(new Error('Connection lost'));

    const result = await storage.increment('test-key', 60000, 5, 0, 'default');

    expect(result).toEqual({
      totalHits: 1,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  });
});
