# 💳 Turning on payments (15 minutes, with your dad)

Everything in the code is ready. The only thing missing is a real checkout link,
and that needs one real-world step first.

---

## ⚠️ Read this bit first — it matters
**Every payment platform (Gumroad, Stripe, PayPal, Lemon Squeezy) requires the
account holder to be 18 or older.** That's their rule and the law around handling
money, not something to work around. Trying to get past it with a fake birthday
gets accounts frozen *with your money inside them* — that's the actual risk, and
it happens to people constantly.

**So: the account goes in your dad's name.** He signs up, his bank details, his
name on the tax bit. You build the product and run it; he holds the account and
you two sort out the money between you. That's completely normal — plenty of
teenage businesses run exactly like this, and it means the money is safe.

---

## Step 1 — Your dad creates the account (10 min)

**Easiest option: Gumroad** (gumroad.com)
- No monthly fee, takes ~10% per sale
- Handles receipts, refunds and overseas tax automatically
- Works fine for a subscription

He needs: his name, email, date of birth, and a bank account for payouts.

*(Stripe is the alternative — lower fees, but more paperwork. Gumroad first.)*

## Step 2 — Make the product
In Gumroad: **New Product → Membership**
- **Name:** AdForge Pro
- **Price:** $9 / month
- **Description:**
  > Unlimited AI-made ads from your real product. No watermark, 30-second ads,
  > all four narrator voices, 1080p export.
- Publish it, then **copy the product URL** (looks like `https://yourname.gumroad.com/l/adforge`)

## Step 3 — Paste it in (10 seconds)
Open `app/checkout.ts` and replace this line:

```ts
export const CHECKOUT_URL = "REPLACE_WITH_YOUR_CHECKOUT_LINK";
```

with:

```ts
export const CHECKOUT_URL = "https://yourname.gumroad.com/l/adforge";
```

Then redeploy. Every "Go Pro" button on the site and in the studio instantly
becomes a real checkout. **Nothing else needs changing** — it's already wired.

Do the same in Zenith's `app/page.tsx` (the `BUY` object at the top) for the
Zenith Pro and Business plans.

---

## Step 4 — Giving buyers their Pro access
Right now Pro unlocks with a code. When someone buys:
1. Gumroad emails you the sale
2. Send them the unlock code: `FORGE-PRO-e7Zk9Qp2`
   *(or a link: `https://makeadforge.vercel.app/studio?unlock=FORGE-PRO-e7Zk9Qp2`)*

**This is fine for your first ~20 customers** and gets you selling this week.

⚠️ Honest limitation: it's one shared code, so a buyer could pass it around. Once
you have steady sales, the proper fix is real accounts (each customer logs in and
their purchase is checked automatically). That's a bigger build — worth doing
*after* money is actually coming in, not before.

---

## What it costs you to run
| | Cost |
|---|---|
| Website hosting (Vercel free) | **$0** |
| AI that writes the ads (Groq free tier) | **$0** |
| Narration (OpenAI TTS) | **~$0.004 per ad** |
| Gumroad fee | ~10% of each sale |

So a $9 sale nets you roughly **$8**, and each ad costs under half a cent to make.

---

## The order I'd do it in
1. ✅ Product works (done)
2. **Get 5 people using it free** and watch what breaks
3. Then do Steps 1–3 above and switch payments on
4. Post the ads AdForge makes — the product markets itself

Don't rush to payments before people actually want it. Free users who love it are
worth more right now than a checkout button nobody clicks.
