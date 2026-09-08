// The five chat rooms. Accent colours are used by the client for theming.
export const ROOMS = [
  {
    id: 'lobby',
    name: 'The Lobby',
    topic: 'Everyone lands here first. Say hello.',
    glyph: '✦',
    accent: '#c9a227',
  },
  {
    id: 'design',
    name: 'Design Studio',
    topic: 'Type, colour, layout and the pursuit of taste.',
    glyph: '◈',
    accent: '#7f5af0',
  },
  {
    id: 'engineering',
    name: 'Engineering',
    topic: 'Shipping, debugging and arguing about tabs.',
    glyph: '⌘',
    accent: '#2cb67d',
  },
  {
    id: 'music',
    name: 'Listening Room',
    topic: 'What is on the turntable right now?',
    glyph: '♪',
    accent: '#ff6b6b',
  },
  {
    id: 'latenight',
    name: 'Late Night',
    topic: 'Slow thoughts after midnight.',
    glyph: '☾',
    accent: '#4ea8de',
  },
];

export const ROOM_IDS = new Set(ROOMS.map((r) => r.id));

// A little seeded history so a fresh room never feels like an empty warehouse.
const HOUR = 1000 * 60 * 60;

const SEEDS = {
  lobby: [
    ['Margot', 'Doors are open. Coffee is metaphorical but the company is real.', 5.5],
    ['Idris', 'Morning all — first time here, the type on this thing is gorgeous.', 4.2],
    ['Margot', 'Welcome Idris. Rule one: be interesting. Rule two: there is no rule two.', 4.1],
    ['Wren', 'Anyone else find the Late Night room at 3am? Different atmosphere entirely.', 1.4],
  ],
  design: [
    ['Sena', 'Hot take: a serif in an interface reads as confidence, not nostalgia.', 6.0],
    ['Oli', 'Agreed, as long as the x-height carries at 14px. Otherwise it is a poster, not a UI.', 5.8],
    ['Sena', 'Right. Big serif for voice, clean serif for body, and let the spacing do the rest.', 5.7],
    ['Junie', 'Dropping a palette later — muted ink, warm gold, one cold blue for the links.', 2.2],
  ],
  engineering: [
    ['Rafi', 'Websocket reconnect logic is 20 lines and saves 200 support tickets.', 7.1],
    ['Cass', 'Exponential backoff or you will DDOS yourself on the first outage.', 6.9],
    ['Rafi', 'Shipped it with jitter. Sleep is restored.', 6.4],
    ['Dev', 'Anyone reviewing the presence refactor today? It is small, I promise.', 1.1],
  ],
  music: [
    ['Nia', 'Side B of this record is the whole reason to own a turntable.', 8.0],
    ['Theo', 'Putting on something with brushed drums and too much reverb.', 5.2],
    ['Nia', 'That is a genre now, apparently. I am fully on board.', 5.1],
    ['Theo', 'Queue is open — drop one track each, no skipping.', 0.8],
  ],
  latenight: [
    ['Halle', 'It is quiet enough here that you can hear yourself think in full sentences.', 9.0],
    ['Sam', 'Best ideas arrive at 2:47am and refuse to be written down.', 6.6],
    ['Halle', 'Keep a notebook by the bed. Half of it is nonsense, half of it is a company.', 6.5],
    ['Sam', 'Signing off. Leaving the lamp on for whoever comes next.', 2.0],
  ],
};

const AVATAR_HUES = {};

export function buildInitialHistory() {
  const now = Date.now();
  const history = {};
  for (const room of ROOMS) {
    history[room.id] = (SEEDS[room.id] || []).map(([author, text, hoursAgo], i) => ({
      id: `seed-${room.id}-${i}`,
      type: 'message',
      room: room.id,
      author,
      text,
      at: now - Math.round(hoursAgo * HOUR),
      seeded: true,
    }));
  }
  return history;
}

export function hueFor(name) {
  if (AVATAR_HUES[name] !== undefined) return AVATAR_HUES[name];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  AVATAR_HUES[name] = h;
  return h;
}
