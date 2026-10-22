// Finance Command Center - personal broker relay.
//
// A tiny Cloudflare Worker that YOU run in YOUR OWN Cloudflare account, so the Finance Command Center app on your
// phone can read your broker accounts whose servers refuse calls from a web page (Zerodha, IBKR Flex, Dhan ...).
//
// What it does: passes your app's requests on to your broker and the answers back. Nothing else.
//  - It only talks to the broker servers listed in BROKERS below - it cannot be used to reach anything else.
//  - Read-only: placing, changing or cancelling orders is blocked here, whatever the app sends.
//  - It answers only your app (ALLOWED_ORIGIN) and only requests carrying your relay key (RELAY_KEY).
//  - It stores nothing and logs nothing. Your broker API keys stay encrypted in the app on your phone; the relay never
//    holds them.

export const VERSION = "1.7.0";

// broker id -> the API servers it may reach (https only). An entry starting with "." allows that broker's own
// sub-domains only (Kotak Neo gives each user a data server like e21.kotaksecurities.com at sign-in).
export const BROKERS = {
  zerodha: ["api.kite.trade"],
  upstox: ["api.upstox.com"],
  dhan: ["api.dhan.co"],
  icici: ["api.icicidirect.com"],
  hdfcsec: ["developer.hdfcsec.com"],
  "5paisa": ["openapi.5paisa.com"],
  fivepaisa: ["openapi.5paisa.com"],
  fyers: ["api-t1.fyers.in"],
  kotak: ["mis.kotaksecurities.com", ".kotaksecurities.com"],
  ibkr: ["ndcdyn.interactivebrokers.com", "gdcdyn.interactivebrokers.com"],
  etoro: ["public-api.etoro.com"],
  saxo: ["live.logonvalidation.net", "gateway.saxobank.com"],
  iifl: ["api.iiflcapital.com"],
  aliceblue: ["a3.aliceblueonline.com"],
  mstock: ["api.mstock.trade"],
  rupeezy: ["vortex-api.rupeezy.in"],
  schwab: ["api.schwabapi.com"],
  etrade: ["api.etrade.com"],
  public: ["api.public.com"],
  webull: ["api.webull.com"],
  trading212: ["live.trading212.com"],
  starling: ["api.starlingbank.com"],
  wise: ["api.wise.com"],
  bunq: ["api.bunq.com"],
};

export function hostAllowed(broker, host) {
  const list = BROKERS[broker];
  if (!list || !/^[a-z0-9.-]+$/i.test(host || "")) return false;
  const h = host.toLowerCase();
  return list.some((e) => (e.startsWith(".") ? h.endsWith(e) && h.length > e.length : h === e));
}

// anything that can trade or move money is refused, whatever the method
const WRITE_PATH = /(^|\/)(orders?|place[-_]?order|modify[-_]?order|cancel[-_]?order|gtt|basket|baskets|alerts?|sip|mf\/orders|mf\/sips|funds\/transfer|payout|withdraw|trade(?!book|s?\/?history))(\/|$|\?)/i;
// the only POST calls allowed: logins / token exchanges (they create a session, they cannot trade)
const LOGIN_POST = [
  /^\/session\/token$/,                                   // Zerodha
  /^\/v2\/login\/authorization\/token$/,                  // Upstox
  /^\/v2\/renewtoken$/i,                                  // Dhan
  /^\/breezeapi\/api\/v1\/customerdetails$/i,             // ICICI Breeze
  /^\/token$/,                                           // Saxo (OAuth PKCE code exchange)
  /^\/api\/v3\/validate-authcode$/,                       // Fyers
  /^\/v1\/getusersession$/,                               // IIFL Capital (checksum exchange)
  /^\/open-api\/od\/v1\/vendor\/getUserDetails$/,         // Alice Blue (checksum exchange)
  /^\/openapi\/typea\/session\/verifytotp$/,              // mStock (TOTP sign-in)
  /^\/v2\/user\/session$/,                                // Rupeezy (checksum exchange)
  /^\/v1\/(installation|device-server|session-server)$/,   // bunq (device registration + session - the body is forwarded byte for byte, so its signature holds)
  /^\/userapiauthservice\/personal\/access-tokens$/,        // Public.com (personal secret -> access token)
  /\/oauth\/token$/i, /\/login\b/i, /\/access-?token$/i, /\/getaccesstoken$/i,
  // read calls that these brokers define as POST (they return data, they cannot trade)
  /^\/VendorsAPI\/Service1\.svc\/V[234]\/(Holding|NetPositionNetWise|Margin)$/i,   // 5paisa
  /^\/quick\/user\/limits$/,                              // Kotak Neo funds
];
const HOP = ["host", "origin", "referer", "cookie", "x-relay-key", "cf-connecting-ip", "x-forwarded-for", "x-real-ip"];

function cors(origin, allowed) {
  const ok = allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : allowed[0] || "null",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

const json = (body, status, headers) => new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" } });

function sameKey(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length || a.length < 16) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export default {
  async fetch(request, env) {
    const allowed = String(env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
    const origin = request.headers.get("Origin") || "";
    const h = cors(origin, allowed);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    if (!allowed.includes(origin)) return json({ error: "this relay answers only its owner's app" }, 403, h);
    if (!env.RELAY_KEY || String(env.RELAY_KEY).length < 16) return json({ error: "RELAY_KEY is not set (at least 16 characters)" }, 500, h);
    if (!sameKey(request.headers.get("X-Relay-Key") || "", String(env.RELAY_KEY))) return json({ error: "wrong relay key" }, 401, h);

    const url = new URL(request.url);
    // /health - lets the app test the setup
    if (url.pathname === "/health") return json({ ok: true, version: VERSION, brokers: Object.keys(BROKERS) }, 200, h);

    // /<broker>/<host>/<path...>?<query>
    const parts = url.pathname.split("/").filter(Boolean);
    const [broker, host, ...rest] = parts;
    if (!broker || !BROKERS[broker]) return json({ error: "unknown broker" }, 404, h);
    if (!host || !hostAllowed(broker, host)) return json({ error: `this relay does not reach ${host || "that server"} for ${broker}` }, 403, h);
    const path = "/" + rest.join("/");
    if (!["GET", "POST"].includes(request.method)) return json({ error: "read-only relay: only GET (and login POST) are allowed" }, 405, h);
    if (WRITE_PATH.test(path)) return json({ error: "read-only relay: trading and money-movement calls are blocked" }, 403, h);
    if (request.method === "POST" && !LOGIN_POST.some((rx) => rx.test(path))) return json({ error: "read-only relay: only login / token POST calls are allowed" }, 403, h);

    const headers = new Headers();
    for (const [k, v] of request.headers) if (!HOP.includes(k.toLowerCase()) && !k.toLowerCase().startsWith("cf-") && !k.toLowerCase().startsWith("sec-")) headers.set(k, v);
    headers.set("User-Agent", "FinanceCommandCenter-PersonalRelay/" + VERSION);   // IBKR Flex requires a User-Agent
    const upstream = await fetch(`https://${host}${path}${url.search}`, {
      method: request.method,
      headers,
      body: request.method === "POST" ? await request.arrayBuffer() : undefined,
      redirect: "manual",
    });
    const out = new Headers(h);
    const ct = upstream.headers.get("Content-Type");
    if (ct) out.set("Content-Type", ct);
    out.set("Cache-Control", "no-store");
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
