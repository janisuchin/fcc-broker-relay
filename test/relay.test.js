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

test("browser preflight", async () => {
  const r = await relay.fetch(new Request("https://r.example/health", { method: "OPTIONS", headers: { Origin: ORIGIN } }), env);
  assert.equal(r.status, 204);
});
