// ── PAYMENT ─────────────────────────────────────────────────────────────────
// Paste your Gumroad / Stripe Payment Link here once the account exists.
// IMPORTANT: payment accounts require the holder to be 18+, so this must be set
// up in a parent's name — see PAYMENTS-SETUP.md. Until a real link is pasted,
// the buttons collect emails instead of pretending to take money.
export const CHECKOUT_URL = "REPLACE_WITH_YOUR_CHECKOUT_LINK";
export const PRICE = "$9";
export const isLive = () => CHECKOUT_URL.startsWith("http");
