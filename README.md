# Your personal broker relay (Finance Command Center)

Some brokers (Zerodha, IBKR, Dhan, Kotak Neo, IIFL Capital, Alice Blue …) do not let a web app on your phone talk to their servers
directly. This tiny relay, running **in your own free Cloudflare account**, passes your app's requests on to your
broker and the answers back. You own it; nobody else - not even the makers of the app - can see or use it.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/janisuchin/fcc-broker-relay) <!-- privacy-scan: ignore (owner approved publishing under this account, 2026-10-20) -->

## Is it safe?
- **Read-only.** Placing, changing or cancelling orders and moving money are blocked inside the relay.
- **Only your broker.** It reaches only the broker servers listed in `src/index.js`, nothing else.
- **Only your app.** It answers only the Finance Command Center app, and only requests carrying your relay key.
- **Stores and logs nothing.** Your broker keys stay encrypted in the app on your phone; the relay never holds them.
- **Small enough to read** - the whole relay is one file of about 100 lines.

## Set it up (about 10 minutes, once)
1. In the app: **Settings → Live broker connections → Create relay key**. Copy the key.
2. Press **Deploy to Cloudflare** above. Sign in, or create a free Cloudflare account. It also asks to connect a free
   GitHub account - your copy of the relay is kept there.
3. When asked for **RELAY_KEY**, paste the key from step 1. Leave ALLOWED_ORIGIN as it is. Press **Deploy**.
4. Cloudflare shows your relay's address, like `https://fcc-broker-relay.<your-name>.workers.dev`. Copy it.
5. In the app, paste the address and press **Test**. A green tick means it works.

To stop using it: delete the Worker in your Cloudflare dashboard (Workers & Pages → fcc-broker-relay → Settings →
Delete). There is nothing else to clean up.

## Cost
Free. The free Cloudflare plan allows 100,000 requests a day; reading your accounts uses a few dozen.
