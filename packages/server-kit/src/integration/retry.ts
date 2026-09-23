// The retry rule every outbound integration follows (DEV-10 §1-2): exponential backoff, three
// attempts, 5xx and network errors retried, 4xx recorded and given up on. Mail (DEV-10 §3) is the
// first caller; payments and OAuth follow, which is why this is not inside the mail module.
export interface RetryOptions {
  // Total attempts including the first, not the number of retries after it.
  attempts?: number;
  delaysMs?: number[];
  // Injected by tests so they do not wait out the real backoff.
  sleep?: (ms: number) => Promise<void>;
}

// DEV-10 §1-2's schedule. Callers that run inside ctx.waitUntil() should weigh this against the
// Worker's lifetime rather than assuming all three attempts will happen.
export const DEFAULT_RETRY_DELAYS_MS = [10_000, 30_000, 60_000];

// Thrown by a caller that classified its failure as transient. Anything else propagates on the
// first attempt: retrying a 422 just sends the same invalid request twice more.
export class RetryableError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "RetryableError";
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(operation: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const delays = options.delaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const attempts = options.attempts ?? 3;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (!(error instanceof RetryableError)) throw error;
      lastError = error;

      // No sleep after the final attempt — waiting out a backoff nobody uses delays the caller's
      // failure log by a minute.
      if (attempt < attempts) await sleep(delays[attempt - 1] ?? delays[delays.length - 1]!);
    }
  }

  throw lastError;
}

// Shared by every integration that has to decide whether a status code is worth another attempt.
export function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}
