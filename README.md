# TierForge

TierForge is a local-first tier-list builder. It imports TierMaker lists and supported game wikis,
keeps boards as ordinary JSON files, caches images locally, and exports PNG, Markdown, CSV, or a
TierMaker remix.

# Try it out at:

https://tierforge.lilacsummons.xyz/

## Start

Double-click `TierForge.cmd`, or run:

```powershell
npm run serve
```

## Deploy to Cloudflare Workers

The hosted build uses Cloudflare Workers Static Assets. Boards are kept in that browser's
`localStorage`; the local Node runtime continues to use files in `Saved/`. Because browser storage
is specific to a browser and device, export important boards before clearing site data or moving
devices.

```powershell
npm install
npm run deploy
```

For a Git-connected Cloudflare Workers build, Wrangler runs the repository's configured build
automatically:

- Build command: leave blank
- Deploy command: `npx wrangler deploy`

No environment variables, secrets, databases, or manually provisioned Cloudflare resources are
required. The static-assets binding is configured automatically. Local `npm run dev` and
`npm run deploy` commands also rebuild `public/` through Wrangler's custom build step.

Hosted imports use bundled Slay the Spire 2 catalogs and images, so normal use does not scrape or
hotlink another website. The original wiki URL and any TierMaker URL are retained as recovery
fallbacks. `npm run update:catalogs` refreshes both catalog metadata and missing catalog images.
Only maintained files under `Images/catalogs/` are included in the Cloudflare deployment;
`Images/imports/` remains a machine-local cache.

Users can also choose an image directory from the Import dialog. The browser copies supported
images into IndexedDB, preserves the relative paths internally, and matches them to board items by
filename. Browser security requires the user to select the directory; a site cannot open a path
such as `C:\Users\name\Images` on its own.

PNG exports contain the complete board JSON in a standard PNG `iTXt` metadata chunk. Dragging the
original exported PNG back into TierForge restores the editable board; an ordinary PNG still adds
as a normal image. Browser-library fallbacks used by the board are embedded into this metadata so
the shared board does not depend on the sender's IndexedDB. Screenshots and image re-encoders can
strip metadata, so share the original downloaded file.

## Importing

Open **Import** to load a built-in catalog, paste a TierMaker `/list/` or `/create/` URL, or choose
an image folder. Hosted boards prefer TierForge's catalog assets, then the source wiki, then a
retained TierMaker image, and finally the browser image library.

The local runtime additionally offers these image modes:

- **Remote**: leave image URLs online. Fastest, but requires the source host.
- **Local files**: download into the relevant folder under `Images/`. Catalog images are maintained
  under `Images/catalogs/`; ad-hoc source imports go under `Images/imports/`.
- **Embedded**: put base64 image data inside the Board. Portable, but produces large JSON files.

The **Slay the Spire 2 cards/relics** shortcuts use the bundled wiki catalogs when hosted and can
refresh directly from the wiki in the local runtime. The Neow relic TierMaker list is detected automatically and
relinks against the Relics List, including TierMaker's filename-style tile labels. **Merge into
current board** adds only new entries. **Relink items** inventories the
current board and `Images/` first, keeps items that are already saved locally, then checks only the
unresolved names against the wiki. It preserves tiers, tags, and notes and downloads only matching
wiki images that are still missing.

TierMaker remix links keep placements in that site's browser storage rather than in the URL. Use
the bookmarklet under **Import → Grab from page** when a remix cannot be read directly. Drag the
bookmarklet link to the bookmarks bar, or use **Copy bookmark code** and paste it into a new
bookmark's URL field. Run it on the loaded TierMaker page, then paste its output back into TierForge.

## Controls

- Click tiles to select; Shift-click selects a range.
- Drag one selected tile to move the full selection.
- Hold `Ctrl` while dropping before another item to make the same relative move on every sub-board.
- Press `1`–`9` to move selected items to a tier, or `0` for the pool.
- Press `/` to search, `Ctrl+A` to select matches, `Delete` to remove, and `Ctrl+Z` to undo.
- Double-click a tile to edit its name, image, tags, and notes.
- `Ctrl+S` saves a named Board using its title. Autosave runs after every edit.

Search terms are ANDed. Filters include `tag:starter`, `tier:A`, `note:vulnerable`, `-word`, and
quoted phrases.
