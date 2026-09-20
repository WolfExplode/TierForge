# ADR-0003: Host ephemeral co-op rooms in Durable Objects

- Status: Accepted
- Date: 2026-09-20

## Context

TierForge's hosted application stores Boards in one browser. Collaborative ranking needs a shared,
ordered source of truth, live presence, participant-specific undo, and reconnect handling. The local
Node runtime remains dependency-free and is not intended to expose a machine as an internet server.

## Decision

Use one SQLite-backed Cloudflare Durable Object per co-op room and hibernatable WebSockets for up to
four participants. The creator is the initial host and controls room lifecycle only. All participants
may edit the Board.

Clients send conditional operations containing before and after values. The room applies operations
in order and rejects stale conflicting changes. It retains a bounded history per participant;
selective undo reverses only values that still match that participant's change, preserving newer
conflicting edits.

Presence messages carry cursors and selected item IDs but are not persisted. Local-only image
references are removed from the shared Board and appear as placeholders. The shared Board never
replaces normal browser Autosave. A room is deleted after 60 seconds with no connected participants.
If only the host remains disconnected for that period, host status transfers to the
longest-connected participant.

## Consequences

- Co-op works on the deployed site and under `wrangler dev`, not the local Node runtime.
- Invite codes are bearer secrets; accounts are not required.
- Participants must explicitly save or export a Board they want to keep.
- Editing pauses during a lost connection instead of attempting an offline merge.
- Board and retained-history sizes are bounded below the Durable Object value limit.
