import { Test, TestingModule } from '@nestjs/testing';
import { CacheService } from './cache.service';
import { RedisService } from '../redis/redis.service';
import { DistributedLockService } from './distributed-lock.service';
import { ExecutionError } from 'redlock';

describe('CacheService', () => {
  let service: CacheService;
  let redisService: jest.Mocked<RedisService>;
  let distributedLockService: jest.Mocked<DistributedLockService>;
  let mockRedisClient: any;

  beforeEach(async () => {
    mockRedisClient = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };

    redisService = {
      isAvailable: jest.fn().mockReturnValue(true),
      getClient: jest.fn().mockReturnValue(mockRedisClient),
    } as any;

    distributedLockService = {
      using: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheService,
        { provide: RedisService, useValue: redisService },
        { provide: DistributedLockService, useValue: distributedLockService },
      ],
    }).compile();

    service = module.get<CacheService>(CacheService);
  });

  it('should return cached value immediately on cache hit', async () => {
    mockRedisClient.get.mockResolvedValue(JSON.stringify({ value: 'cached' }));
    const factory = jest.fn();

    const result = await service.getOrSet('test-key', factory, 60);

    expect(result).toEqual({ value: 'cached' });
    expect(mockRedisClient.get).toHaveBeenCalledWith('test-key');
    expect(factory).not.toHaveBeenCalled();
    expect(distributedLockService.using).not.toHaveBeenCalled();
  });

  it('should run factory, store value, and return on cache miss with acquired lock', async () => {
    mockRedisClient.get.mockResolvedValue(null);
    const factory = jest.fn().mockResolvedValue({ value: 'regenerated' });

    // Mock distributedLockService.using to execute the callback instantly
    distributedLockService.using.mockImplementation(async (lockKey, ttlMs, callback) => {
      return callback();
    });

    const result = await service.getOrSet('test-key', factory, 60);

    expect(result).toEqual({ value: 'regenerated' });
    expect(mockRedisClient.get).toHaveBeenCalledTimes(2); // Initial lookups + double-check
    expect(factory).toHaveBeenCalled();
    expect(mockRedisClient.set).toHaveBeenCalled();
  });

  it('should reuse cache in double-check if another instance populated it while waiting for the lock', async () => {
    // Initial lookup returns null
    mockRedisClient.get.mockResolvedValueOnce(null);

    // Double-check lookup inside the lock returns the newly cached value
    mockRedisClient.get.mockResolvedValueOnce(JSON.stringify({ value: 'newly-populated-by-other-node' }));

    const factory = jest.fn();

    distributedLockService.using.mockImplementation(async (lockKey, ttlMs, callback) => {
      return callback();
    });

    const result = await service.getOrSet('test-key', factory, 60);

    expect(result).toEqual({ value: 'newly-populated-by-other-node' });
    expect(mockRedisClient.get).toHaveBeenCalledTimes(2); // Initial look + double check look
    expect(factory).not.toHaveBeenCalled(); // Factory bypassed because of double-check match
    expect(mockRedisClient.set).not.toHaveBeenCalled();
  });

  it('should retry cache lookup and succeed if lock fails to acquire but cache gets populated', async () => {
    mockRedisClient.get.mockResolvedValueOnce(null); // Initial look: miss

    // Mock lock failure by throwing an error from distributedLockService.using
    distributedLockService.using.mockRejectedValue(new Error('Lock contention'));

    // Mock subsequent retry attempts. The 3rd attempt returns the cache populated by the owner.
    mockRedisClient.get
      .mockResolvedValueOnce(null) // Attempt 1
      .mockResolvedValueOnce(null) // Attempt 2
      .mockResolvedValueOnce(JSON.stringify({ value: 'populated-during-lock-wait' })); // Attempt 3

    const factory = jest.fn();

    const result = await service.getOrSet('test-key', factory, 60);

    expect(result).toEqual({ value: 'populated-during-lock-wait' });
    expect(factory).not.toHaveBeenCalled(); // Bypassed factory because lookup retry found value
  });

  it('should fall back to executing the factory directly if lock fails and cache remains missing after all retries', async () => {
    mockRedisClient.get.mockResolvedValue(null); // Initial and all retry lookups return null
    distributedLockService.using.mockRejectedValue(new Error('Lock timeout'));

    const factory = jest.fn().mockResolvedValue({ value: 'direct-fallback-value' });

    const result = await service.getOrSet('test-key', factory, 60);

    expect(result).toEqual({ value: 'direct-fallback-value' });
    expect(factory).toHaveBeenCalled();
  });

  it('should degrade gracefully and execute factory directly if Redis is not available', async () => {
    redisService.isAvailable.mockReturnValue(false);
    const factory = jest.fn().mockResolvedValue({ value: 'offline-value' });

    const result = await service.getOrSet('test-key', factory, 60);

    expect(result).toEqual({ value: 'offline-value' });
    expect(factory).toHaveBeenCalled();
    expect(mockRedisClient.get).not.toHaveBeenCalled();
    expect(distributedLockService.using).not.toHaveBeenCalled();
  });
});
