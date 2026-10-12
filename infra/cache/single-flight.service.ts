import { Injectable } from '@nestjs/common';

@Injectable()
export class SingleFlightService {
  private readonly inflight = new Map<string, Promise<unknown>>();

  async execute<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key) as Promise<T> | undefined;

    if (existing) return existing;

    const promise = (async () => {
      try {
        return await fetcher();
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, promise);

    return promise;
  }

  get activeCount(): number {
    return this.inflight.size;
  }
}
