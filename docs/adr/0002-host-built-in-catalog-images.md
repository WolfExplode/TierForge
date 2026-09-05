# ADR-0002: Host built-in catalog images as static assets

- Status: Accepted
- Date: 2026-09-05

## Context

Built-in catalogs pointed at external wiki images. Browser hotlink protections made those images
unreliable and routed normal page loads through a Worker proxy. The `Images/` directory also mixed
maintained game assets with ad-hoc TierMaker downloads.

## Decision

Version built-in images under `Images/catalogs/<game>/<item-type>/` and copy that tree into the
Cloudflare static asset build. Keep ad-hoc downloads under ignored `Images/imports/<source>/`
directories. Catalog items prefer the hosted asset, then the original wiki URL, an imported
TierMaker URL, and finally a browser-local image.

Wrangler owns the build step so Git-connected deployments need only run `npx wrangler deploy`.
Generated `public/Images/` files are ignored to avoid storing the same binaries twice in Git.

## Consequences

- Built-in boards render and export without scraping or hotlinking another site.
- The source repository stores one copy of each maintained image.
- Catalog refreshes also download missing maintained assets.
- External fallbacks still recover from an incomplete deployment or missing asset.
- Adding another game requires a catalog directory and corresponding source definition.
