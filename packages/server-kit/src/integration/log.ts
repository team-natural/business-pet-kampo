// Structured logging for outbound integrations (DEV-10 §8-1). JSON on one line, because Workers
// Logs indexes fields but not prose.
export interface IntegrationLogContext {
  requestId: string;
  service: string;
  action: string;
  [field: string]: unknown;
}

// Provider responses go in the log truncated (DEV-10 §1-2). An untruncated body can carry the
// recipient's address and the whole message into a log nobody treats as personal data.
const MAX_RESPONSE_CHARS = 500;

export function truncateForLog(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > MAX_RESPONSE_CHARS ? `${text.slice(0, MAX_RESPONSE_CHARS)}…` : text;
}

export function logIntegrationInfo(context: IntegrationLogContext, message: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: "info", message, ...context, ...fields }));
}

export function logIntegrationError(context: IntegrationLogContext, message: string, fields: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ level: "error", message, ...context, ...fields }));
}

// Callers pass this to every log line of one operation so a retry sequence can be reassembled.
export function newRequestId(): string {
  return crypto.randomUUID();
}
