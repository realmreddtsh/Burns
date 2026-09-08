/* Burns — client. Live rooms over a single websocket. */

const $ = (id) => document.getElementById(id);

const el = {
  gate: $('gate'),
  gateForm: $('gateForm'),
  gateFoot: $('gateFoot'),
  nameInput: $('nameInput'),
  app: $('app'),
  roomList: $('roomList'),
  roomName: $('roomName'),
  roomTopic: $('roomTopic'),
  messages: $('messages'),
  stream: $('stream'),
  composer: $('composer'),
  input: $('input'),
  send: $('send'),
  typing: $('typing'),
  typingText: $('typingText'),
  peopleList: $('peopleList'),
  peopleCount: $('peopleCount'),
  peoplePanel: $('peoplePanel'),
  status: $('status'),
  statusText: $('statusText'),
  meBtn: $('meBtn'),
  meName: $('meName'),
  meAvatar: $('meAvatar'),
  menuBtn: $('menuBtn'),
  peopleBtn: $('peopleBtn'),
  scrim: $('scrim'),
  rail: document.querySelector('.rail'),
};

const state = {
  name: localStorage.getItem('burns:name') || '',
  meId: null,
  rooms: [],
  roomsById: new Map(),
  room: localStorage.getItem('burns:room') || 'lobby',
  counts: {},
  unread: new Set(),
  ws: null,
  attempt: 0,
  renaming: false,
  lastAuthor: null,
  lastAt: 0,
  lastDay: null,
};

/* ------------------------- helpers ------------------------- */

const hue = (name) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
};

const initials = (name) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('') || '?';

const timeOf = (ts) =>
  new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const dayOf = (ts) => new Date(ts).toDateString();

function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date(today.getTime() - 864e5);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function avatar(name) {
  const s = document.createElement('span');
  s.className = 'avatar';
  s.style.setProperty('--h', hue(name));
  s.textContent = initials(name);
  return s;
}

let toastTimer;
function toast(text) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 350);
  }, 2600);
}

function setStatus(kind, text) {
  el.status.className = `status ${kind}`;
  el.statusText.textContent = text;
}

/* ------------------------- rooms rail ------------------------- */

function renderRooms() {
  el.roomList.innerHTML = '';
  for (const room of state.rooms) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'room';
    btn.style.setProperty('--room-accent', room.accent);
    btn.dataset.room = room.id;
    if (room.id === state.room) btn.classList.add('active');
    if (state.unread.has(room.id)) btn.classList.add('unread');

    const glyph = document.createElement('span');
    glyph.className = 'room-glyph';
    glyph.textContent = room.glyph;

    const text = document.createElement('span');
    text.className = 'room-text';
    const name = document.createElement('span');
    name.className = 'room-name';
    name.textContent = room.name;
    const topic = document.createElement('span');
    topic.className = 'room-topic';
    topic.textContent = room.topic;
    text.append(name, topic);

    const count = document.createElement('span');
    count.className = 'room-count';
    count.dataset.count = room.id;
    const n = state.counts[room.id] || 0;
    count.textContent = n;
    if (n > 0) count.classList.add('live');

    btn.append(glyph, text, count);
    btn.addEventListener('click', () => selectRoom(room.id));
    el.roomList.appendChild(btn);
  }
}

function updateCounts() {
  for (const room of state.rooms) {
    const node = el.roomList.querySelector(`[data-count="${room.id}"]`);
    if (!node) continue;
    const n = state.counts[room.id] || 0;
    node.textContent = n;
    node.classList.toggle('live', n > 0);
  }
}

function markActiveRoom() {
  el.roomList.querySelectorAll('.room').forEach((node) => {
    const isActive = node.dataset.room === state.room;
    node.classList.toggle('active', isActive);
    if (isActive) node.classList.remove('unread');
  });
  const room = state.roomsById.get(state.room);
  if (!room) return;
  document.documentElement.style.setProperty('--accent', room.accent);
  el.roomName.textContent = room.name;
  el.roomTopic.textContent = room.topic;
  // replay the header animation
  [el.roomName, el.roomTopic].forEach((n) => {
    n.style.animation = 'none';
    void n.offsetWidth;
    n.style.animation = '';
  });
}

function selectRoom(id) {
  if (id === state.room) {
    closePanels();
    return;
  }
  state.room = id;
  localStorage.setItem('burns:room', id);
  state.unread.delete(id);
  markActiveRoom();
  closePanels();
  el.messages.innerHTML = '';
  resetStacking();
  setTyping([]);
  send({ type: 'join', room: id });
}

/* ------------------------- message stream ------------------------- */

function resetStacking() {
  state.lastAuthor = null;
  state.lastAt = 0;
  state.lastDay = null;
}

function nearBottom() {
  const s = el.stream;
  return s.scrollHeight - s.scrollTop - s.clientHeight < 140;
}

function scrollToBottom(smooth = true) {
  el.stream.scrollTo({ top: el.stream.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

function maybeDayMark(ts, delay) {
  const day = dayOf(ts);
  if (day === state.lastDay) return;
  state.lastDay = day;
  const mark = document.createElement('div');
  mark.className = 'daymark';
  mark.style.setProperty('--d', `${delay}s`);
  mark.innerHTML = `<span>${dayLabel(ts)}</span>`;
  el.messages.appendChild(mark);
}

function renderEntry(entry, delay = 0) {
  maybeDayMark(entry.at, delay);

  if (entry.type === 'system') {
    const row = document.createElement('div');
    row.className = 'sys';
    row.style.setProperty('--d', `${delay}s`);
    row.innerHTML = '<span></span>';
    row.firstChild.textContent = entry.text;
    el.messages.appendChild(row);
    state.lastAuthor = null;
    return;
  }

  const mine = entry.authorId ? entry.authorId === state.meId : false;
  const stacked =
    state.lastAuthor === entry.author && entry.at - state.lastAt < 1000 * 60 * 5;

  const row = document.createElement('div');
  row.className = `msg${mine ? ' mine' : ''}${stacked ? ' stacked' : ''}`;
  row.style.setProperty('--d', `${delay}s`);
  row.style.setProperty('--h', hue(entry.author));

  row.appendChild(avatar(entry.author));

  const main = document.createElement('div');
  main.className = 'msg-main';

  const head = document.createElement('div');
  head.className = 'msg-head';
  const author = document.createElement('span');
  author.className = 'msg-author';
  author.textContent = entry.author;
  const time = document.createElement('span');
  time.className = 'msg-time';
  time.textContent = timeOf(entry.at);
  head.append(author, time);

  const body = document.createElement('p');
  body.className = 'msg-body';
  body.textContent = entry.text;

  main.append(head, body);
  row.appendChild(main);
  el.messages.appendChild(row);

  state.lastAuthor = entry.author;
  state.lastAt = entry.at;
}

function renderHistory(messages) {
  el.messages.innerHTML = '';
  resetStacking();

  if (!messages.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = '<span>A quiet room.</span>';
    const p = document.createElement('p');
    p.textContent = 'Nothing has been said here yet. Be the first.';
    empty.appendChild(p);
    el.messages.appendChild(empty);
    return;
  }

  // Stagger the last handful so the room "arrives" rather than snapping in.
  const start = Math.max(0, messages.length - 14);
  messages.forEach((m, i) => renderEntry(m, i < start ? 0 : (i - start) * 0.035));
  requestAnimationFrame(() => scrollToBottom(false));
}

function appendLive(entry) {
  el.messages.querySelector('.empty')?.remove();
  const stick = nearBottom();
  renderEntry(entry);
  if (stick) requestAnimationFrame(() => scrollToBottom(true));
}

function setTyping(names) {
  if (!names.length) {
    el.typing.classList.remove('on');
    el.typingText.textContent = '';
    return;
  }
  const text =
    names.length === 1
      ? `${names[0]} is typing`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing`
        : `${names.length} people are typing`;
  el.typingText.textContent = text;
  el.typing.classList.add('on');
}

function renderPeople(people) {
  el.peopleList.innerHTML = '';
  el.peopleCount.textContent = people.length;
  people
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((person, i) => {
      const li = document.createElement('li');
      li.className = `person${person.id === state.meId ? ' self' : ''}`;
      li.style.animationDelay = `${i * 0.03}s`;
      li.appendChild(avatar(person.name));
      const name = document.createElement('span');
      name.className = 'person-name';
      name.textContent = person.name + (person.id === state.meId ? ' (you)' : '');
      li.appendChild(name);
      el.peopleList.appendChild(li);
    });
}

function setIdentity(name) {
  state.name = name;
  localStorage.setItem('burns:name', name);
  el.meName.textContent = name;
  el.meAvatar.textContent = initials(name);
  el.meAvatar.style.setProperty('--h', hue(name));
}

/* ------------------------- socket ------------------------- */

function send(payload) {
  if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(payload));
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  state.ws = ws;
  setStatus('wait', state.attempt ? 'reconnecting' : 'connecting');

  ws.addEventListener('open', () => {
    state.attempt = 0;
    setStatus('', 'live');
    el.send.disabled = false;
    send({ type: 'hello', name: state.name, room: state.room });
  });

  ws.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    handle(msg);
  });

  ws.addEventListener('close', () => {
    setStatus('off', 'offline');
    el.send.disabled = true;
    state.attempt += 1;
    const wait = Math.min(1000 * 2 ** (state.attempt - 1), 10000) + Math.random() * 400;
    setTimeout(connect, wait);
  });

  ws.addEventListener('error', () => ws.close());
}

function handle(msg) {
  switch (msg.type) {
    case 'welcome':
      state.rooms = msg.rooms;
      state.roomsById = new Map(msg.rooms.map((r) => [r.id, r]));
      if (!state.roomsById.has(state.room)) state.room = msg.rooms[0].id;
      state.counts = msg.counts || {};
      state.meId = msg.you;
      renderRooms();
      markActiveRoom();
      break;

    case 'identity':
      state.meId = msg.id;
      if (msg.name !== state.name) {
        if (state.renaming) toast(`You are now “${msg.name}”`);
        else if (localStorage.getItem('burns:name') !== msg.name)
          toast(`That name was taken — you are “${msg.name}”`);
      }
      state.renaming = false;
      setIdentity(msg.name);
      break;

    case 'history':
      if (msg.room !== state.room) break;
      renderHistory(msg.messages);
      renderPeople(msg.people || []);
      break;

    case 'presence':
      if (msg.room === state.room) renderPeople(msg.people);
      break;

    case 'counts':
      state.counts = msg.counts;
      updateCounts();
      break;

    case 'typing':
      if (msg.room === state.room) setTyping(msg.names);
      break;

    case 'message':
    case 'system':
      if (msg.room === state.room) {
        appendLive(msg);
      } else if (msg.type === 'message') {
        state.unread.add(msg.room);
        el.roomList.querySelector(`[data-room="${msg.room}"]`)?.classList.add('unread');
      }
      break;

    default:
      break;
  }
}

/* ------------------------- composer ------------------------- */

function autoGrow() {
  el.input.style.height = 'auto';
  el.input.style.height = `${Math.min(el.input.scrollHeight, 168)}px`;
}

let typingOn = false;
let typingStop;
function signalTyping() {
  if (!typingOn) {
    typingOn = true;
    send({ type: 'typing', active: true });
  }
  clearTimeout(typingStop);
  typingStop = setTimeout(() => {
    typingOn = false;
    send({ type: 'typing', active: false });
  }, 2200);
}

function submitMessage() {
  const text = el.input.value.trim();
  if (!text) return;
  send({ type: 'message', text });
  el.input.value = '';
  autoGrow();
  clearTimeout(typingStop);
  typingOn = false;
  el.input.focus();
}

el.composer.addEventListener('submit', (e) => {
  e.preventDefault();
  submitMessage();
});

el.input.addEventListener('input', () => {
  autoGrow();
  if (el.input.value.trim()) signalTyping();
});

el.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitMessage();
  }
});

/* ------------------------- gate & panels ------------------------- */

function openGate(renaming = false) {
  state.renaming = renaming;
  el.gate.classList.remove('hidden');
  el.gateFoot.classList.remove('error');
  el.gateFoot.textContent = renaming
    ? 'Everyone in your room will see the change.'
    : 'You can change your name at any time.';
  el.nameInput.value = state.name;
  el.gate.querySelector('.gate-btn').textContent = renaming ? 'Save name' : 'Enter the rooms';
  setTimeout(() => {
    el.nameInput.focus();
    el.nameInput.select();
  }, 60);
}

function closeGate() {
  el.gate.classList.add('hidden');
  el.app.setAttribute('aria-hidden', 'false');
  el.app.classList.add('ready');
  setTimeout(() => el.input.focus(), 200);
}

el.gateForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = el.nameInput.value.trim().replace(/\s+/g, ' ').slice(0, 24);
  if (name.length < 2) {
    el.gateFoot.textContent = 'Give us at least two characters to work with.';
    el.gateFoot.classList.add('error');
    el.nameInput.focus();
    return;
  }
  const renaming = state.renaming;
  setIdentity(name);
  closeGate();
  if (renaming) send({ type: 'rename', name });
  else if (state.ws?.readyState === WebSocket.OPEN) send({ type: 'hello', name, room: state.room });
});

el.meBtn.addEventListener('click', () => openGate(true));

function closePanels() {
  el.rail.classList.remove('open');
  el.peoplePanel.classList.remove('open');
  el.scrim.classList.remove('on');
}
el.menuBtn.addEventListener('click', () => {
  el.rail.classList.toggle('open');
  el.scrim.classList.toggle('on', el.rail.classList.contains('open'));
});
el.peopleBtn.addEventListener('click', () => {
  el.peoplePanel.classList.toggle('open');
  el.scrim.classList.toggle('on', el.peoplePanel.classList.contains('open'));
});
el.scrim.addEventListener('click', closePanels);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePanels();
});

/* ------------------------- boot ------------------------- */

if (state.name) {
  setIdentity(state.name);
  closeGate();
} else {
  openGate(false);
}
connect();
