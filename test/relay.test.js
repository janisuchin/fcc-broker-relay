import { test } from "node:test";
import assert from "node:assert/strict";
import relay from "../src/index.js";

const ORIGIN = "https://finance-command-center.german-journey.workers.dev";
const env = { ALLOWED_ORIGIN: ORIGIN, RELAY_KEY: "K".repeat(24) };
const req = (path, init = {}, key = env.RELAY_KEY, origin = ORIGIN) =>
  new Request("https://relay.example.workers.dev" + path, { ...init, headers: { Origin: origin, "X-Relay-Key": key, ...(init.headers || {}) } });

let calls = [];
globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response('{"data":[]}', { status: 200, headers: { "Content-Type": "application/json" } }); };

test("health with the right key", async () => {
  const r = await relay.fetch(req("/health"), env);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});

test("wrong key, wrong origin, key not configured", async () => {
  assert.equal((await relay.fetch(req("/health", {}, "x".repeat(24)), env)).status, 401);
  assert.equal((await relay.fetch(req("/health", {}, env.RELAY_KEY, "https://evil.example"), env)).status, 403);
  assert.equal((await relay.fetch(req("/health"), { ALLOWED_ORIGIN: ORIGIN })).status, 500);
});

test("forwards a read call to a listed broker server only", async () => {
  calls = [];
  const r = await relay.fetch(req("/zerodha/api.kite.trade/portfolio/holdings", { headers: { Authorization: "token a:b" } }), env);
  assert.equal(r.status, 200);
  assert.equal(calls[0].url, "https://api.kite.trade/portfolio/holdings");
  assert.equal(calls[0].init.headers.get("authorization"), "token a:b");
  assert.equal(calls[0].init.headers.get("x-relay-key"), null);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal((await relay.fetch(req("/zerodha/evil.example/x"), env)).status, 403);
  assert.equal((await relay.fetch(req("/unknown/api.kite.trade/x"), env)).status, 404);
});

test("read-only: orders and money movement blocked, only login POSTs", async () => {
  for (const p of ["/zerodha/api.kite.trade/orders/regular", "/upstox/api.upstox.com/v2/order/place", "/dhan/api.dhan.co/v2/orders", "/zerodha/api.kite.trade/gtt/triggers", "/zerodha/api.kite.trade/mf/orders"])
    assert.equal((await relay.fetch(req(p), env)).status, 403, p);
  assert.equal((await relay.fetch(req("/zerodha/api.kite.trade/portfolio/holdings", { method: "POST", body: "x" }), env)).status, 403);
  assert.equal((await relay.fetch(req("/zerodha/api.kite.trade/session/token", { method: "POST", body: "x" }), env)).status, 200);
  assert.equal((await relay.fetch(req("/zerodha/api.kite.trade/portfolio/holdings", { method: "DELETE" }), env)).status, 405);
  // reading the trade history is a read
  assert.equal((await relay.fetch(req("/zerodha/api.kite.trade/trades"), env)).status, 200);
  assert.equal((await relay.fetch(req("/ibkr/ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest?t=1&q=2&v=3"), env)).status, 200);
});

test("Saxo sign-in step and data", async () => {
  assert.equal((await relay.fetch(req("/saxo/live.logonvalidation.net/token", { method: "POST", body: "grant_type=authorization_code" }), env)).status, 200);
  assert.equal((await relay.fetch(req("/saxo/gateway.saxobank.com/openapi/port/v1/balances/me"), env)).status, 200);
  assert.equal((await relay.fetch(req("/saxo/gateway.saxobank.com/openapi/trade/v2/orders", { method: "POST", body: "{}" }), env)).status, 403);
});

test("Kotak per-user servers: only Kotak's own sub-domains", async () => {
  assert.equal((await relay.fetch(req("/kotak/e21.kotaksecurities.com/portfolio/v1/holdings"), env)).status, 200);
  assert.equal((await relay.fetch(req("/kotak/evilkotaksecurities.com/x"), env)).status, 403);
  assert.equal((await relay.fetch(req("/kotak/kotaksecurities.com.evil.example/x"), env)).status, 403);
  assert.equal((await relay.fetch(req("/kotak/e21.kotaksecurities.com/quick/user/limits", { method: "POST", body: "jData=x" }), env)).status, 200);
});

test("Fyers and 5paisa", async () => {
  assert.equal((await relay.fetch(req("/fyers/api-t1.fyers.in/api/v3/validate-authcode", { method: "POST", body: "{}" }), env)).status, 200);
  assert.equal((await relay.fetch(req("/fyers/api-t1.fyers.in/api/v3/holdings"), env)).status, 200);
  assert.equal((await relay.fetch(req("/fivepaisa/openapi.5paisa.com/VendorsAPI/Service1.svc/V3/Holding", { method: "POST", body: "{}" }), env)).status, 200);
  assert.equal((await relay.fetch(req("/fivepaisa/openapi.5paisa.com/VendorsAPI/Service1.svc/V1/PlaceOrderRequest", { method: "POST", body: "{}" }), env)).status, 403);
});

test("IIFL Capital, Alice Blue and mStock: sign-in and reads pass, orders do not", async () => {
  assert.equal((await relay.fetch(req("/iifl/api.iiflcapital.com/v1/getusersession", { method: "POST", body: "{}" }), env)).status, 200);
  assert.equal((await relay.fetch(req("/iifl/api.iiflcapital.com/v1/holdings"), env)).status, 200);
  assert.equal((await relay.fetch(req("/iifl/api.iiflcapital.com/v1/orders", { method: "POST", body: "{}" }), env)).status, 403);
  assert.equal((await relay.fetch(req("/aliceblue/a3.aliceblueonline.com/open-api/od/v1/vendor/getUserDetails", { method: "POST", body: "{}" }), env)).status, 200);
  assert.equal((await relay.fetch(req("/aliceblue/a3.aliceblueonline.com/open-api/od/v1/limits/"), env)).status, 200);
  assert.equal((await relay.fetch(req("/aliceblue/a3.aliceblueonline.com/open-api/od/v1/orders/placeorder", { method: "POST", body: "{}" }), env)).status, 403);
  assert.equal((await relay.fetch(req("/mstock/api.mstock.trade/openapi/typea/session/verifytotp", { method: "POST", body: "api_key=x&totp=1" }), env)).status, 200);
  assert.equal((await relay.fetch(req("/mstock/api.mstock.trade/openapi/typea/portfolio/holdings"), env)).status, 200);
  assert.equal((await relay.fetch(req("/mstock/api.mstock.trade/openapi/typea/orders/regular", { method: "POST", body: "x" }), env)).status, 403);
  assert.equal((await relay.fetch(req("/mstock/api.iiflcapital.com/v1/holdings"), env)).status, 403);
});

test("Rupeezy: sign-in, holdings and quotes pass, orders do not", async () => {
  assert.equal((await relay.fetch(req("/rupeezy/vortex-api.rupeezy.in/v2/user/session", { method: "POST", body: "{}" }), env)).status, 200);
  assert.equal((await relay.fetch(req("/rupeezy/vortex-api.rupeezy.in/v2/data/quotes?q=NSE%3AX&mode=ltp"), env)).status, 200);
  assert.equal((await relay.fetch(req("/rupeezy/vortex-api.rupeezy.in/v2/trading/orders/regular", { method: "POST", body: "{}" }), env)).status, 403);
});

test("US brokers: Schwab, E*TRADE, Public, Webull - sign-in and reads pass, orders do not", async () => {
  assert.equal((await relay.fetch(req("/schwab/api.schwabapi.com/v1/oauth/token", { method: "POST", body: "grant_type=x" }), env)).status, 200);
  assert.equal((await relay.fetch(req("/schwab/api.schwabapi.com/trader/v1/accounts?fields=positions"), env)).status, 200);
  assert.equal((await relay.fetch(req("/schwab/api.schwabapi.com/trader/v1/accounts/H1/orders", { method: "POST", body: "{}" }), env)).status, 403);
  assert.equal((await relay.fetch(req("/etrade/api.etrade.com/oauth/request_token"), env)).status, 200);
  assert.equal((await relay.fetch(req("/etrade/api.etrade.com/v1/accounts/K1/portfolio.json"), env)).status, 200);
  assert.equal((await relay.fetch(req("/etrade/api.etrade.com/v1/accounts/K1/orders/place.json", { method: "POST", body: "{}" }), env)).status, 403);
  assert.equal((await relay.fetch(req("/public/api.public.com/userapiauthservice/personal/access-tokens", { method: "POST", body: "{}" }), env)).status, 200);
  assert.equal((await relay.fetch(req("/public/api.public.com/userapigateway/trading/A1/portfolio/v2"), env)).status, 200);
  assert.equal((await relay.fetch(req("/public/api.public.com/userapigateway/trading/A1/order", { method: "POST", body: "{}" }), env)).status, 403);
  assert.equal((await relay.fetch(req("/webull/api.webull.com/trading/accounts/list"), env)).status, 200);
  assert.equal((await relay.fetch(req("/webull/api.webull.com/trade/place_order", { method: "POST", body: "{}" }), env)).status, 403);
});

test("Europe: Trading 212, eToro, Starling, Wise - reads pass, orders and payments do not", async () => {
  assert.equal((await relay.fetch(req("/trading212/live.trading212.com/api/v0/equity/positions"), env)).status, 200);
  assert.equal((await relay.fetch(req("/trading212/live.trading212.com/api/v0/equity/orders/market", { method: "POST", body: "{}" }), env)).status, 403);
  assert.equal((await relay.fetch(req("/etoro/public-api.etoro.com/api/v1/trading/info/real/pnl"), env)).status, 200);
  assert.equal((await relay.fetch(req("/starling/api.starlingbank.com/api/v2/accounts"), env)).status, 200);
  assert.equal((await relay.fetch(req("/starling/api.starlingbank.com/api/v2/payments/local/account/A/category/C", { method: "POST", body: "{}" }), env)).status, 403);
  assert.equal((await relay.fetch(req("/wise/api.wise.com/v4/profiles/1/balances?types=STANDARD"), env)).status, 200);
  assert.equal((await relay.fetch(req("/wise/api.wise.com/v1/transfers", { method: "POST", body: "{}" }), env)).status, 403);
});

test("bunq: the three registration calls and reads pass; payments do not", async () => {
  assert.equal((await relay.fetch(req("/bunq/api.bunq.com/v1/installation", { method: "POST", body: "{}" }), env)).status, 200);
  assert.equal((await relay.fetch(req("/bunq/api.bunq.com/v1/session-server", { method: "POST", body: "{}" }), env)).status, 200);
  assert.equal((await relay.fetch(req("/bunq/api.bunq.com/v1/user/42/monetary-account?count=200"), env)).status, 200);
  assert.equal((await relay.fetch(req("/bunq/api.bunq.com/v1/user/42/monetary-account/7/payment", { method: "POST", body: "{}" }), env)).status, 403);
  const body = '{"secret":"x"}';
  await relay.fetch(req("/bunq/api.bunq.com/v1/session-server", { method: "POST", body }), env);
  assert.equal(new TextDecoder().decode(calls[calls.length - 1].init.body), body);         // byte for byte
});

test("browser preflight", async () => {
  const r = await relay.fetch(new Request("https://r.example/health", { method: "OPTIONS", headers: { Origin: ORIGIN } }), env);
  assert.equal(r.status, 204);
});

test("crypto exchanges: balance reads pass; orders, withdrawals and other POSTs do not", async () => {
  assert.equal((await relay.fetch(req("/binance/api.binance.com/api/v3/account?timestamp=1&signature=x"), env)).status, 200);
  assert.equal((await relay.fetch(req("/binance/api.binance.com/api/v3/order", { method: "POST", body: "x" }), env)).status, 403);
  assert.equal((await relay.fetch(req("/binance/api.binance.com/sapi/v1/capital/withdraw/apply", { method: "POST", body: "x" }), env)).status, 403);
  assert.equal((await relay.fetch(req("/coinbase/api.coinbase.com/api/v3/brokerage/accounts?limit=250"), env)).status, 200);
  assert.equal((await relay.fetch(req("/coinbase/api.coinbase.com/api/v3/brokerage/orders", { method: "POST", body: "{}" }), env)).status, 403);
  assert.equal((await relay.fetch(req("/kraken/api.kraken.com/0/private/Balance", { method: "POST", body: "nonce=1" }), env)).status, 200);
  assert.equal((await relay.fetch(req("/kraken/api.kraken.com/0/private/AddOrder", { method: "POST", body: "nonce=1" }), env)).status, 403);
  assert.equal((await relay.fetch(req("/kraken/api.kraken.com/0/private/Withdraw", { method: "POST", body: "nonce=1" }), env)).status, 403);
  assert.equal((await relay.fetch(req("/kucoin/api.kucoin.com/api/v1/accounts"), env)).status, 200);
  assert.equal((await relay.fetch(req("/kucoin/evil.example.com/api/v1/accounts"), env)).status, 403);
});

test("regional crypto exchanges: balance reads and the two allowed POSTs; nothing else", async () => {
  for (const [b, path] of [["luno", "/luno/api.luno.com/api/1/balance"], ["valr", "/valr/api.valr.com/v1/account/balances"], ["bitso", "/bitso/api.bitso.com/v3/balance/"],
    ["upbit", "/upbit/api.upbit.com/v1/accounts"], ["wazirx", "/wazirx/api.wazirx.com/sapi/v1/funds?timestamp=1&signature=x"], ["coinswitch", "/coinswitch/coinswitch.co/trade/api/v2/user/portfolio"],
    ["bitvavo", "/bitvavo/api.bitvavo.com/v2/balance"], ["btcturk", "/btcturk/api.btcturk.com/api/v1/users/balances"], ["mercadobitcoin", "/mercadobitcoin/api.mercadobitcoin.net/api/v4/accounts"]])
    assert.equal((await relay.fetch(req(path), env)).status, 200, b);
  assert.equal((await relay.fetch(req("/coindcx/api.coindcx.com/exchange/v1/users/balances", { method: "POST", body: "{}" }), env)).status, 200);
  assert.equal((await relay.fetch(req("/coindcx/api.coindcx.com/exchange/v1/orders/create", { method: "POST", body: "{}" }), env)).status, 403);
  assert.equal((await relay.fetch(req("/mercadobitcoin/api.mercadobitcoin.net/oauth2/token", { method: "POST", body: "x" }), env)).status, 200);
  assert.equal((await relay.fetch(req("/valr/api.valr.com/v1/orders/market", { method: "POST", body: "{}" }), env)).status, 403);
  assert.equal((await relay.fetch(req("/luno/api.luno.com/api/1/send", { method: "POST", body: "x" }), env)).status, 403);
});

test("the CoinSwitch read exception is exact: its order calls stay blocked", async () => {
  assert.equal((await relay.fetch(req("/coinswitch/coinswitch.co/trade/api/v2/order", { method: "POST", body: "{}" }), env)).status, 403);
  assert.equal((await relay.fetch(req("/coinswitch/coinswitch.co/trade/api/v2/orders"), env)).status, 403);
  assert.equal((await relay.fetch(req("/coinswitch/coinswitch.co/trade/api/v2/user/portfolio", { method: "POST", body: "{}" }), env)).status, 403);
});
