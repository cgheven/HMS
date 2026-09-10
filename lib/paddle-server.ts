import "server-only";
import { Paddle, Environment } from "@paddle/paddle-node-sdk";

/**
 * Server-side Paddle client (uses the secret API key). Also used to verify
 * webhook signatures via paddle.webhooks.unmarshal(). Never import from a client
 * component — this is server-only and carries the API key.
 */
export function getPaddleServer(): Paddle {
  const apiKey = process.env.PADDLE_API_KEY;
  if (!apiKey) throw new Error("PADDLE_API_KEY is not set");
  return new Paddle(apiKey, {
    environment: process.env.PADDLE_ENV === "production" ? Environment.production : Environment.sandbox,
  });
}
