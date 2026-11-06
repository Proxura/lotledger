import { handle, json } from '../../lib/core.ts';

/** The publishable key is public by design; the browser needs it to mount embedded Checkout. */
export const onRequestGet = handle(async (ctx) => {
  return json({ publishableKey: ctx.env.STRIPE_PUBLISHABLE_KEY || '', configured: !!(ctx.env.STRIPE_SECRET_KEY && ctx.env.STRIPE_PUBLISHABLE_KEY) });
});
