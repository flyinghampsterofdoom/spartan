import assert from "node:assert/strict";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${path}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("anonymous visitors are redirected away from the operational shell", async () => {
  const response = await render("/");
  assert.equal(response.status, 307);
  assert.match(response.headers.get("location") ?? "", /\/login$/);
});

test("anonymous visitors cannot access company or platform administration", async () => {
  for (const path of ["/settings", "/platform-admin", "/account"]) {
    const response = await render(path);
    assert.equal(response.status, 307);
    assert.match(response.headers.get("location") ?? "", /\/login$/);
  }
});

test("the public login page preserves Spartan's visual identity", async () => {
  const response = await render("/login");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Spartan — Construction Operations/);
  assert.match(html, /Welcome back/);
  assert.match(html, /SECURE ACCESS/);
  assert.doesNotMatch(html, /Good morning, Justin/);
  assert.doesNotMatch(html, /codex-preview/);
});
