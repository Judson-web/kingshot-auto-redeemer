# Workers VPC webhook egress controls

## Active Cloudflare Gateway rules

These account-level rules are enabled and scoped to Workers VPC traffic only. They do not match ordinary WARP/device traffic or the separate Mesh-origin rules.

| Address family | Rule ID | Precedence | Action |
| --- | --- | ---: | --- |
| IPv4 | `821258ad-6dd7-49dd-b3cf-528cd10416ae` | 3 | Block |
| IPv6 | `b8387556-4ea7-4a67-8358-8af15de7130d` | 4 | Block |

The read-back expressions are:

```text
net.onramp.type == "workers_vpc" and net.dst.ip in {0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.0.0.0/24 192.0.2.0/24 192.31.196.0/24 192.52.193.0/24 192.88.99.0/24 192.168.0.0/16 192.175.48.0/24 198.18.0.0/15 198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4}

net.onramp.type == "workers_vpc" and net.dst.ip in {:: ::1 64:ff9b:1::/48 100::/64 2001::/23 2001:20::/28 2001:db8::/32 2002::/16 fc00::/7 fe80::/10 fec0::/10 ff00::/8}
```

The existing Mesh-only rules remain separately enabled at precedence 1 and 2. The Workers VPC policies were accepted by the Gateway API and read back with the expected selector and CIDR sets. A temporary disabled selector probe was removed after validation.

## Important verification boundary

Cloudflare documents that `cf1:network` Worker egress is evaluated by Gateway. Cloudflare's network-session dataset identifies this traffic as `OnrampType = WORKERS_VPC` and exposes `SourceName`, `SourceID`, `OriginIP`, `ResolvedFQDN`, and `EgressRuleName`.

No staging Worker has been deployed and no Workers VPC session has yet been generated for this project. Therefore, the rules' configuration is verified, but a live match against a Workers VPC request is **not yet proven**. Before enabling webhook delivery, a separately approved staging-only Worker must make controlled public and private-address test requests. Gateway network logs must show the Workers VPC source and the expected rule name for blocked private destinations, while a public HTTPS test destination succeeds. Do not use production delivery traffic as the test.

No Logpush job or external log destination has been created. The Cloudflare account API confirmed the `zero_trust_network_sessions` dataset fields and returned no existing jobs.

## DNS rebinding and application checks

The Worker uses only `env.EGRESS.fetch()` for subscriber-controlled destinations, with redirects disabled. The shared URL validator rejects non-HTTPS URLs, credentials, nonstandard ports, IP literals (including URL-parser-normalized shorthand/decimal/octal/hex IPv4 forms), single-label hosts, and reserved local suffixes: `.localhost`, `.local`, `.internal`, `.home.arpa`, `.test`, `.invalid`, `.example`, `.onion`, and `.lan`.

These checks are only the first layer. They cannot safely resolve and pin a subscriber hostname themselves. Gateway's network-layer destination-IP rules are the connection-time control intended to stop DNS rebinding to private, loopback, link-local, and other special-use addresses.

Cloudflare normalized an attempted IPv4-mapped IPv6 CIDR (`::ffff:0:0/96`) into `0.0.0.0/0`. That unsafe rule was immediately deleted and recreated without the mapped prefix. Do not add that expression back. The replacement IPv6 rule was read back and contains no IPv4 catch-all.

## Local Supabase integration

The CI workflow starts disposable local Supabase Auth and PostgREST services, applies only the two V4 migrations to a minimal isolated baseline, and exercises the actual RPCs through the local REST API. It does not use production credentials or link the CLI to a remote project.

The repository's historical migration directory is not a complete, version-aligned reproduction of the remote project's migration history. The local stack job deliberately isolates the two V4 migrations rather than claiming that a full production-schema `supabase db reset` is reproducible. Full-project schema parity remains a separate migration task.


## Cost boundary

Cloudflare's Workers VPC documentation states that the feature is in public beta and available free to all Workers plans: https://developers.cloudflare.com/workers-vpc/. This only covers Workers VPC beta availability. It does not imply that unrelated Cloudflare add-ons, tunnels, logging destinations, or usage beyond included limits are free. No such paid resources have been provisioned for this migration.

A temporary remote probe Worker has not been deployed. Local Worker tests and Wrangler dry-run builds do not prove live Gateway enforcement. Keep webhook dispatch fail-closed until a runtime check can be completed within included free usage, with no production deployment or paid infrastructure.
