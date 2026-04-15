// Shared helpers used across tool handlers.

import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import { SERVER_NAME, RADIUS_MIN, RADIUS_MAX } from "./config.js";

/** Shorthand for the extra parameter that every tool handler receives. */
export type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

export function clampRadius(value: number): number {
  return Math.max(RADIUS_MIN, Math.min(RADIUS_MAX, value));
}

/**
 * Send a progress notification if the client requested one (via progressToken).
 * No-op when the client didn't ask for progress — safe to call unconditionally.
 */
export async function sendProgress(
  extra: ToolExtra,
  progress: number,
  total: number,
  message?: string,
): Promise<void> {
  const token = extra._meta?.progressToken;
  if (token === undefined) return;

  await extra.sendNotification({
    method: "notifications/progress" as const,
    params: { progressToken: token, progress, total, message },
  });
}

/** Disclaimer appended to tool results that contain property price/rental data. */
export const PROPERTY_DISCLAIMER =
  "\n\n*Data is for informational purposes only and does not constitute financial, investment, or property advice.*";

/** Send an info-level log message to the client. */
export async function logInfo(extra: ToolExtra, data: string): Promise<void> {
  await extra.sendNotification({
    method: "notifications/message" as const,
    params: { level: "info", logger: SERVER_NAME, data },
  });
}
