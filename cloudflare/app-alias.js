const APP_UPSTREAM = "https://kingshot-autoredeemer-edge.ks-redeemer.workers.dev";

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

    return fetch(new Request(upstream, init));
  })());
});
