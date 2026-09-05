# TierForge

TierForge is a local-first tier-list builder that imports TierMaker lists and supported game wikis. Boards are stored as JSON and can be exported as PNG, Markdown, CSV, or a TierMaker remix.

**Try it:** https://tierforge.lilacsummons.xyz/

## Run locally

Requires Node.js 20 or later. Double-click `TierForge.cmd`, or run:

```powershell
npm run serve
```

Local boards are saved in `Saved/`; imported images are cached under `Images/`.

## Import

Open **Import** to load a built-in catalog, paste a TierMaker `/list/` or `/create/` URL, or choose an image folder. You can also merge new entries into the current board or relink existing items without changing tiers, tags, or notes.

The local runtime supports three image modes:

- **Remote:** Keep source URLs.
- **Local files:** Cache images under `Images/catalogs/` or `Images/imports/`.
- **Embedded:** Store image data in the board JSON for portability.

TierMaker remix placements are stored in TierMaker's browser storage, not the URL. If a remix cannot be imported directly, use **Import → Grab from page** and follow the bookmarklet instructions.

PNG exports embed the complete board. Drag the original PNG back into TierForge to restore an editable board; screenshots and re-encoded images may lose this metadata.

PNG item images saved by the local importer also embed their item name, tags, description, notes, and
source URL. Adding those files back to TierForge restores those fields automatically.

## Controls

- Click to select; Shift-click to select a range.
- Drag a selected tile to move the selection.
- Hold `Ctrl` while dropping to repeat the relative move across sub-boards.
- Press `1`–`9` to move items to a tier, or `0` for the pool.
- Press `/` to search, `Ctrl+A` to select matches, `Delete` to remove, and `Ctrl+Z` to undo.
- Double-click a tile to edit it; press `Ctrl+S` to save a named board.

Search terms are combined with AND. Filters include `tag:starter`, `tier:A`, `note:vulnerable`, `-word`, and quoted phrases.

## Deploy

TierForge uses Cloudflare Workers Static Assets:

```powershell
npm install
npm run deploy
```

For Git-connected deployments, leave the build command blank and use `npx wrangler deploy` as the deploy command. No secrets, databases, or manually provisioned Cloudflare resources are required.

Hosted boards use browser `localStorage`, so export important boards before clearing site data or switching devices. Catalog assets are bundled; refresh them with `npm run update:catalogs`.
