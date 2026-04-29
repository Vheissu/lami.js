export interface Scheduler {
  queue(job: () => void): void;
  flush(): Promise<void>;
}

const jobQueue = new Set<() => void>();
let pending = false;
let currentFlush: Promise<void> | null = null;

function drainJobs(): void {
  pending = false;
  const jobs = [...jobQueue];
  jobQueue.clear();

  for (const job of jobs) {
    job();
  }
}

export function queueJob(job: () => void): void {
  jobQueue.add(job);
  if (pending) return;

  pending = true;
  currentFlush = new Promise(resolve => {
    queueMicrotask(() => {
      try {
        drainJobs();
      } finally {
        resolve();
        currentFlush = null;
      }
    });
  });
}

export function flushJobs(): Promise<void> {
  if (currentFlush) return currentFlush.then(() => undefined);
  return new Promise(resolve => queueMicrotask(resolve));
}

export function batch(fn: () => void): void {
  fn();
}

export const defaultScheduler: Scheduler = {
  queue: queueJob,
  flush: flushJobs
};
