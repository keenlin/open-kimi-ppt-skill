import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";

const html = await readFile(new URL("../editor/index.html", import.meta.url), "utf8");
const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];

function editorFetch() {
  let networkCalls = 0;
  class MockFileReader {
    readAsDataURL(file) {
      this.result = `data:${file.type};base64,${Buffer.from("image").toString("base64")}`;
      this.onload();
    }
  }
  const window = { fetch: async () => { networkCalls++; return new Response(); }, INJECT_ENV: {} };
  const context = {
    window,
    localStorage: { setItem() {} },
    document: { documentElement: { classList: { remove() {}, add() {} } } },
    FormData,
    Blob,
    FileReader: MockFileReader,
    Response,
    XMLHttpRequest: class { open() {} send() {} },
  };
  runInNewContext(script, context);
  return { fetch: window.fetch, getNetworkCalls: () => networkCalls };
}

test("local image upload returns a usable data URL without a network request", async () => {
  const { fetch, getNetworkCalls } = editorFetch();
  const body = new FormData();
  body.append("image", new Blob(["image"], { type: "image/png" }), "test.png");
  const response = await fetch("/apiv2/slides:upload", { method: "POST", body });
  assert.equal(response.status, 200);
  assert.match((await response.json()).url, /^data:image\/png;base64,/);
  assert.equal(getNetworkCalls(), 0);
});

test("local image upload rejects a request without a file", async () => {
  const { fetch } = editorFetch();
  const response = await fetch("/apiv2/slides:upload", { method: "POST", body: new FormData() });
  assert.equal(response.status, 400);
});