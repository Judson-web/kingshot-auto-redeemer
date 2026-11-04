const APP_UPSTREAM = "https://kingshot-autoredeemer-edge.ks-redeemer.workers.dev";
const CANONICAL_HOST = "app.ks-redeemer.workers.dev";
const LEGACY_HOSTS = [
  "kingshot-autoredeemer-edge.sajijudsa.workers.dev",
  "kingshot-autoredeemer-edge.ks-redeemer.workers.dev",
];

function canonicalize(value) {
  let result = value;
  for (const host of LEGACY_HOSTS) result = result.replaceAll(host, CANONICAL_HOST);
  return result;
}

addEventListener("fetch", (event) => {
  event.respondWith((async () => {
    const incoming = new URL(event.request.url);
    const upstream = new URL(incoming.pathname + incoming.search, APP_UPSTREAM);
    const headers = new Headers(event.request.headers);
    headers.set("x-forwarded-host", incoming.host);
    headers.set("x-forwarded-proto", incoming.protocol.slice(0, -1));

    const init = {
      method: event.request.method,
      headers,
      redirect: "manual",
    };
    if (event.request.method !== "GET" && event.request.method !== "HEAD") {
      init.body = event.request.body;
    }

    const response = await fetch(new Request(upstream, init));
    const responseHeaders = new Headers(response.headers);
    const location = responseHeaders.get("location");
    if (location) responseHeaders.set("location", canonicalize(location));

    const contentType = responseHeaders.get("content-type") || "";
    const rewritable = /^(text\/|application\/(?:json|ld\+json|manifest\+json|javascript|xml))/i.test(contentType);
    if (
      !rewritable ||
      !response.body ||
      event.request.method === "HEAD" ||
      response.status === 204 ||
      response.status === 206 ||
      response.status === 304
    ) {
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    }

    const body = canonicalize(await response.text());
    responseHeaders.delete("content-length");
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("etag");
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  })());
});
