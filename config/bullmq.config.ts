export const DEFAULT_BULLMQ_OPTIONS = {
  prefix: 'vetsbridge:bull',
  defaultJobOptions: {
    removeOnComplete: {
      count: 100,
      age: 24 * 3600, // 24 hours
    },
    removeOnFail: {
      count: 500,
      age: 7 * 24 * 3600, // 7 days
    },
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000, // 5 seconds
    },
  },
  streams: {
    events: {
      maxLen: 1000,
    },
  },
};
export type BullmqOptions = typeof DEFAULT_BULLMQ_OPTIONS;
