import { describe, expect, test } from "bun:test";
import { createMiddleware } from "../src/middleware.js";

const onRequest = createMiddleware({ params: { utm_source: "newsletter" } });

const context = {} as Parameters<typeof onRequest>[0];

function run(response: Response): Promise<Response> {
  return onRequest(context, () => Promise.resolve(response)) as Promise<Response>;
}

describe("createMiddleware", () => {
  test("rewrites external links in HTML responses", async () => {
    const result = await run(
      new Response(`<a href="https://example.com/">x</a>`, {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
    expect(await result.text()).toContain("utm_source=newsletter");
  });

  test("drops stale content-length and content-encoding headers", async () => {
    const body = `<a href="https://example.com/">x</a>`;
    const result = await run(
      new Response(body, {
        headers: {
          "content-type": "text/html",
          "content-length": String(body.length),
          "content-encoding": "gzip",
          "x-custom": "kept",
        },
      }),
    );

    expect(result.headers.get("content-length")).toBeNull();
    expect(result.headers.get("content-encoding")).toBeNull();
    expect(result.headers.get("x-custom")).toBe("kept");
  });

  test("preserves status and statusText", async () => {
    const result = await run(
      new Response(`<a href="https://example.com/">x</a>`, {
        status: 404,
        statusText: "Not Found",
        headers: { "content-type": "text/html" },
      }),
    );
    expect(result.status).toBe(404);
    expect(result.statusText).toBe("Not Found");
  });

  test("passes through non-HTML responses untouched", async () => {
    const response = new Response(`{"href":"https://example.com/"}`, {
      headers: { "content-type": "application/json" },
    });
    expect(await run(response)).toBe(response);
  });

  test("passes through responses with no content-type", async () => {
    const response = new Response("x");
    response.headers.delete("content-type");
    expect(await run(response)).toBe(response);
  });

  test("passes through null-body statuses without constructing a body", async () => {
    const response = new Response(null, {
      status: 304,
      headers: { "content-type": "text/html" },
    });
    expect(await run(response)).toBe(response);
  });

  test("passes through redirects untouched", async () => {
    const response = new Response(null, {
      status: 302,
      headers: { location: "/next", "content-type": "text/html" },
    });
    expect(await run(response)).toBe(response);
  });
});
