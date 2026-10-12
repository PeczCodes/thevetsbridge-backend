import { SingleFlightService } from './single-flight.service';

describe('SingleFlightService', () => {
  let service: SingleFlightService;

  beforeEach(() => {
    service = new SingleFlightService();
  });

  it('should execute fetcher once and return value when no flight is active', async () => {
    const fetcher = jest.fn().mockResolvedValue('data');

    const result = await service.execute('key1', fetcher);

    expect(result).toBe('data');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(service.activeCount).toBe(0);
  });

  it('should coalesce concurrent calls for the same key to a single execution', async () => {
    let resolveFetcher: (val: string) => void;
    const fetcher = jest.fn().mockImplementation(() => {
      return new Promise<string>((resolve) => {
        resolveFetcher = resolve;
      });
    });

    // Launch 3 concurrent flights for the same key
    const p1 = service.execute('key1', fetcher);
    const p2 = service.execute('key1', fetcher);
    const p3 = service.execute('key1', fetcher);

    expect(service.activeCount).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Resolve the single underlying fetcher
    resolveFetcher!('coalesced-data');

    const [res1, res2, res3] = await Promise.all([p1, p2, p3]);

    expect(res1).toBe('coalesced-data');
    expect(res2).toBe('coalesced-data');
    expect(res3).toBe('coalesced-data');
    expect(service.activeCount).toBe(0);
  });

  it('should execute independent calls for different keys separately', async () => {
    const fetcher1 = jest.fn().mockResolvedValue('res1');
    const fetcher2 = jest.fn().mockResolvedValue('res2');

    const [res1, res2] = await Promise.all([
      service.execute('key1', fetcher1),
      service.execute('key2', fetcher2),
    ]);

    expect(res1).toBe('res1');
    expect(res2).toBe('res2');
    expect(fetcher1).toHaveBeenCalledTimes(1);
    expect(fetcher2).toHaveBeenCalledTimes(1);
    expect(service.activeCount).toBe(0);
  });

  it('should clean up in-flight map and reject all coalesced promises when fetcher throws', async () => {
    let rejectFetcher: (err: Error) => void;
    const fetcher = jest.fn().mockImplementation(() => {
      return new Promise((_, reject) => {
        rejectFetcher = reject;
      });
    });

    const p1 = service.execute('key-fail', fetcher);
    const p2 = service.execute('key-fail', fetcher);

    expect(service.activeCount).toBe(1);

    rejectFetcher!(new Error('Fetcher error'));

    await expect(p1).rejects.toThrow('Fetcher error');
    await expect(p2).rejects.toThrow('Fetcher error');
    expect(service.activeCount).toBe(0);
  });

  it('should allow subsequent calls after previous flight has completed', async () => {
    const fetcher1 = jest.fn().mockResolvedValue('first');
    const fetcher2 = jest.fn().mockResolvedValue('second');

    const res1 = await service.execute('key1', fetcher1);
    const res2 = await service.execute('key1', fetcher2);

    expect(res1).toBe('first');
    expect(res2).toBe('second');
    expect(fetcher1).toHaveBeenCalledTimes(1);
    expect(fetcher2).toHaveBeenCalledTimes(1);
  });
});
