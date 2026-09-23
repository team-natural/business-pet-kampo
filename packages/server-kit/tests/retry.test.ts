// The retry rule every outbound integration inherits (DEV-10 §1-2). These pin the two halves that
// are easy to get backwards: which failures earn another attempt, and which do not.
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_RETRY_DELAYS_MS, RetryableError, isRetryableStatus, withRetry } from "../src/integration/retry";

// Injected everywhere so the suite does not sit through the real 10s / 30s / 60s schedule.
const noSleep = () => Promise.resolve();

describe("withRetry", () => {
  it("returns the first success without sleeping", async () => {
    const sleep = vi.fn(noSleep);
    const operation = vi.fn(async () => "sent");

    await expect(withRetry(operation, { sleep })).resolves.toBe("sent");
    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries a RetryableError up to the attempt limit, then rethrows it", async () => {
    const operation = vi.fn(async () => {
      throw new RetryableError("503 from provider");
    });

    await expect(withRetry(operation, { sleep: noSleep })).rejects.toBeInstanceOf(RetryableError);
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("gives up immediately on anything that is not retryable", async () => {
    // A 422 retried three times is the same invalid request sent three times.
    const operation = vi.fn(async () => {
      throw new Error("422 invalid recipient");
    });

    await expect(withRetry(operation, { sleep: noSleep })).rejects.toThrow("422 invalid recipient");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("succeeds on a later attempt after transient failures", async () => {
    let calls = 0;
    const operation = vi.fn(async () => {
      if (++calls < 3) throw new RetryableError("temporary");
      return "sent";
    });

    await expect(withRetry(operation, { sleep: noSleep })).resolves.toBe("sent");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("waits the documented backoff between attempts, and not after the last one", async () => {
    const waited: number[] = [];
    const operation = async () => {
      throw new RetryableError("temporary");
    };

    await withRetry(operation, { sleep: async (ms) => void waited.push(ms) }).catch(() => {});

    // Two sleeps for three attempts. A third would delay the failure log by a minute for nothing.
    expect(waited).toEqual(DEFAULT_RETRY_DELAYS_MS.slice(0, 2));
  });
});

describe("isRetryableStatus", () => {
  it("retries server errors, timeouts and throttling", () => {
    for (const status of [500, 502, 503, 408, 429]) expect(isRetryableStatus(status), String(status)).toBe(true);
  });

  it("does not retry the client errors that will fail the same way again", () => {
    for (const status of [400, 401, 403, 404, 422]) expect(isRetryableStatus(status), String(status)).toBe(false);
  });
});
