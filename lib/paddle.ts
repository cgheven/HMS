import "server-only";

export type PaddleClientConfig = {
  /** 'sandbox' while we build/test; 'production' once live. */
  environment: "sandbox" | "production";
  /** Public client-side token — safe to expose in the browser (Paddle.js needs it). */
  clientToken: string;
  /** The subscription price the checkout opens. */
  priceId: string;
};

/**
 * Paddle config the browser needs to open checkout. Read on the server from env
 * and handed to the client as props: the client token is a PUBLIC token, and the
 * environment + price id are not secrets. The server API key is never included.
 * Returns empty strings when unconfigured, so the UI simply hides the control.
 */
export function getPaddleClientConfig(): PaddleClientConfig {
  return {
    environment: process.env.PADDLE_ENV === "production" ? "production" : "sandbox",
    clientToken: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN ?? "",
    priceId: process.env.PADDLE_PRICE_ID ?? "",
  };
}
