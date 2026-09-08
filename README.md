# Burns

A live chat room app: **five rooms**, real-time messaging over WebSockets, display names, and a quiet dark interface set in a modern serif.

```bash
npm install
npm start        # http://localhost:3000
```

Open a second browser tab (or another device on the network) with a different display name to see the live behaviour.

## What's in it

**Five rooms** — The Lobby, Design Studio, Engineering, Listening Room and Late Night. Each has its own accent colour, glyph and topic, and each ships with a little seeded history so a room never opens empty.

**Live everything** — messages, join/leave notices, per-room occupant counts, the people list and typing indicators all travel over one WebSocket. Presence is corrected by a 30s ping/pong heartbeat, so dead sockets never linger in the counts.

**Display names** — chosen at the door, remembered in `localStorage`, changeable at any time from the bottom of the rail. Duplicate names are automatically de-duplicated by the server (`Margot` → `Margot 2`), and renames are announced in the room.

**Animated chats** — messages fade, lift and unblur as they arrive; room history staggers in so a room "arrives" instead of snapping; typing dots bounce; the active-room marker slides; unread rooms pulse. All of it collapses to nothing under `prefers-reduced-motion`.

**Design** — near-black canvas with drifting colour orbs and a fine grain overlay, glass panels, Instrument Serif for voice and Newsreader for text. Consecutive messages from one author stack, timestamps appear on hover, day dividers separate sessions, and the layout folds into drawers on tablet and mobile.

## Layout

```
server/
  index.js     HTTP + WebSocket server, rooms, presence, typing, history
  rooms.js     Room definitions, accents and seeded conversation
public/
  index.html   Markup and font loading
  styles.css   Dark serif design system, animations, responsive rules
  app.js       Client: socket lifecycle, rendering, composer, panels
```

## Protocol

Client → server: `hello`, `join`, `message`, `typing`, `rename`
Server → client: `welcome`, `identity`, `history`, `message`, `system`, `presence`, `counts`, `typing`

State is in memory (last 120 entries per room) — restart the server and the rooms reset to their seeded history. Swap `history` in `server/index.js` for a store if you want persistence.

Reconnection is automatic with exponential backoff and jitter; the header shows `live`, `reconnecting` or `offline`.
