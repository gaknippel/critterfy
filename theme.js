// shows the current synced lyric line in the now-playing bar, to the right of the
(async function npbLyrics() {
  const LYRICS_URL = "https://spclient.wg.spotify.com/color-lyrics/v2/track/";
  const SPIN_MS = 250; // every reel spins this long before the first one stops
  const STOP_MS_PER_REEL = 83; // then the reels stop left to right, this far apart...
  const STOP_MS_MAX = 750; // ...squeezed into this window for long lines
  const LAND_MS = 330; // length of the npb-land animation in user.css
  const LEAD_MS = 300; // start spinning a bit early so the line lands on time
  const GLYPHS = "█▓▒░#$%&@*+=?!<>/7$0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const BASE_FONT = 13; // px, lines shrink from here to fit...
  const MIN_FONT = 10; // ...down to here, then scroll
  const MIN_SPACE = 80; // px, hide the lyric if the gap gets narrower than this

  const wait = async (fn) => {
    let v;
    while (!(v = fn())) await new Promise((r) => setTimeout(r, 300));
    return v;
  };

  await wait(() => window.Spicetify?.Player?.addEventListener && Spicetify.CosmosAsync);

  const el = document.createElement("div");
  el.className = "npb-lyric npb-lyric--empty";
  const track = document.createElement("div"); // scrolls long lines
  track.className = "npb-lyric__track";
  const reel = document.createElement("div"); // shakes
  reel.className = "npb-lyric__reel";
  track.append(reel);
  el.append(track);

  let lines = []; // [{ start, text }]
  let uri = null;
  let index = -2;
  let spinFrame = null;

  const currentUri = () => (Spicetify.Player.data?.item ?? Spicetify.Player.data?.track)?.uri;
  const randomGlyph = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
  const restartClass = (node, cls) => {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
  };

  // spotify re-renders the bar sometimes, so keep re-attaching our element
  function attach() {
    const bar = document.querySelector('[data-testid="now-playing-bar"]');
    if (!bar || el.parentElement === bar) return;
    if (getComputedStyle(bar).position === "static") bar.style.position = "relative";
    bar.append(el);
  }

  // sit in the gap between the last playback button and the right-side controls
  function place() {
    const bar = el.parentElement;
    const play = bar?.querySelector('[data-testid="control-button-playpause"]');
    if (!play) return;
    const p = play.getBoundingClientRect();
    const midY = (p.top + p.bottom) / 2;

    let left = p.right;
    for (const b of bar.querySelectorAll('[data-testid="player-controls"] button')) {
      const r = b.getBoundingClientRect();
      if (r.width && Math.abs((r.top + r.bottom) / 2 - midY) < 8) left = Math.max(left, r.right);
    }

    const barRect = bar.getBoundingClientRect();
    const controls = bar.querySelector('[data-testid="player-controls"]');
    let right = barRect.right;
    for (const b of bar.querySelectorAll("button, input")) {
      if (controls?.contains(b)) continue;
      const r = b.getBoundingClientRect();
      if (r.width && r.left > left) right = Math.min(right, r.left);
    }

    const space = right - left - 32;
    el.style.left = `${left - barRect.left + 16}px`;
    el.style.top = `${midY - barRect.top}px`;
    el.style.width = `${Math.max(0, space)}px`;
    el.classList.toggle("npb-lyric--hidden", space < MIN_SPACE);

    const current = parseFloat(el.style.fontSize) || BASE_FONT;
    const natural = (reel.offsetWidth * BASE_FONT) / current;
    const size = natural ? Math.max(MIN_FONT, Math.min(BASE_FONT, Math.floor((BASE_FONT * space * 2) / natural) / 2)) : BASE_FONT;
    el.style.fontSize = `${size}px`;

    const over = (natural * size) / BASE_FONT - space;
    el.classList.toggle("npb-lyric--overflow", over > 0);
    el.style.setProperty("--npb-scroll", `${-(over + space * 0.08)}px`);
  }

  async function loadLyrics() {
    const u = currentUri();
    uri = u;
    lines = [];
    show(-1);
    if (!u?.startsWith("spotify:track:")) return;
    try {
      const body = await Spicetify.CosmosAsync.get(
        `${LYRICS_URL}${u.split(":")[2]}?format=json&vocalRemoval=false&market=from_token`
      );
      if (uri !== u || body?.lyrics?.syncType !== "LINE_SYNCED") return; // stale or unsynced
      lines = body.lyrics.lines.map((l) => ({ start: Number(l.startTimeMs), text: l.words.trim() }));
    } catch {
      // no lyrics for this track
    }
  }

  function show(i) {
    index = i;
    cancelAnimationFrame(spinFrame);
    reel.textContent = "";
    track.style.animation = "none";
    el.classList.remove("npb-lyric--spinning", "npb-lyric--thunk");

    const line = lines[i];
    const words = line && line.text !== "♪" ? line.text : "";
    el.classList.toggle("npb-lyric--empty", !words);
    if (!words) return;

    // one reel per character; spaces dont spin
    const reels = [...words].map((c) => {
      const s = document.createElement("span");
      if (c === " ") {
        s.className = "npb-ch npb-ch--space";
        s.textContent = " ";
        reel.append(s);
        return null;
      }
      s.className = "npb-ch npb-ch--spin";
      s.textContent = randomGlyph();
      s.style.animationDelay = `${-Math.random() * 0.25}s`;
      reel.append(s);
      return { s, c };
    }).filter(Boolean);

    const stopWindow = Math.min(reels.length * STOP_MS_PER_REEL, STOP_MS_MAX);
    const stopAt = reels.map((_, k) => SPIN_MS + (k * stopWindow) / reels.length);
    el.classList.add("npb-lyric--spinning");
    place();

    if (el.classList.contains("npb-lyric--overflow")) {
      const landMs = stopAt[stopAt.length - 1] + LAND_MS;
      const lineMs = (lines[i + 1]?.start ?? line.start + 5000) - line.start;
      const scrollMs = Math.max(800, (lineMs - landMs) * 0.8);
      track.style.animation = `npb-scroll ${scrollMs}ms linear ${landMs}ms both`;
    }

    // new random glyph on every display frame until each reel's stop time
    const start = performance.now();
    const spin = (now) => {
      const elapsed = now - start;
      reels.forEach((r, k) => {
        if (!r.s.classList.contains("npb-ch--spin")) return;
        if (elapsed >= stopAt[k]) {
          r.s.textContent = r.c;
          r.s.style.animationDelay = "";
          r.s.className = "npb-ch npb-ch--land";
        } else {
          r.s.textContent = randomGlyph();
        }
      });
      if (elapsed >= stopAt[stopAt.length - 1]) {
        el.classList.remove("npb-lyric--spinning");
        restartClass(el, "npb-lyric--thunk");
      } else {
        spinFrame = requestAnimationFrame(spin);
      }
    };
    spinFrame = requestAnimationFrame(spin);
  }

  function tick() {
    attach();
    if (el.parentElement) place();
    if (!lines.length) return;
    const t = Spicetify.Player.getProgress() + LEAD_MS;
    let i = -1;
    while (i + 1 < lines.length && lines[i + 1].start <= t) i++;
    if (i !== index) show(i);
  }

  Spicetify.Player.addEventListener("songchange", loadLyrics);
  setInterval(tick, 100);
  loadLyrics();
})();

// sets the accent color to the average color of the current album cover.
(async function coverAccent() {
  const SIZE = 32; // cover is scaled down to SIZE x SIZE before averaging
  // Clamp lightness so the accent stays readable on the grey background.
  // Set to [0, 1] for the raw average.
  const LIGHTNESS = [0.6, 0.8];

  while (!window.Spicetify?.Player?.addEventListener) await new Promise((r) => setTimeout(r, 300));

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const root = document.documentElement.style;

  const coverUrl = () => {
    const meta = (Spicetify.Player.data?.item ?? Spicetify.Player.data?.track)?.metadata;
    const url = meta?.image_small_url ?? meta?.image_url;
    return url?.startsWith("spotify:image:") ? `https://i.scdn.co/image/${url.split(":")[2]}` : url;
  };

  const loadImage = (src) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });

  function average(img) {
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
    const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < px.length; i += 4) {
      r += px[i];
      g += px[i + 1];
      b += px[i + 2];
    }
    const n = px.length / 4;
    return [r / n, g / n, b / n];
  }

  function rgbToHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
  }

  function hslToRgb([h, s, l]) {
    const f = (n) => {
      const k = (n + h * 12) % 12;
      const a = s * Math.min(l, 1 - l);
      return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return [f(0), f(8), f(4)];
  }

  const hex = (rgb) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");

  function setAccent(name, rgb) {
    root.setProperty(`--spice-${name}`, hex(rgb));
    root.setProperty(`--spice-rgb-${name}`, rgb.join(","));
  }

  async function update() {
    const url = coverUrl();
    if (!url) return;
    try {
      const img = await loadImage(url);
      if (coverUrl() !== url) return; // song changed while loading
      const [h, s, l] = rgbToHsl(average(img));
      const light = Math.min(LIGHTNESS[1], Math.max(LIGHTNESS[0], l));
      setAccent("button", hslToRgb([h, s, light]));
      setAccent("notification", hslToRgb([h, s, light]));
      setAccent("button-active", hslToRgb([h, s, Math.min(1, light + 0.1)]));
    } catch (e) {
      console.warn("[coverAccent] couldn't read cover", e);
    }
  }

  Spicetify.Player.addEventListener("songchange", update);
  update();
})();

// Flashes the progress bar on every beat of the current song.
(async function beatSync() {
  const BEAT_WINDOW_MS = 150; // skip beats we're already this late for (after a seek or lag)

  while (!window.Spicetify?.getAudioData || !Spicetify.Player?.addEventListener) {
    await new Promise((r) => setTimeout(r, 300));
  }

  let beats = []; // ms
  let bars = new Set(); // ms, beats that start a bar
  let next = 0;
  let lastT = 0;
  let uri = null;

  // Per-device delay, tuned by ear with Ctrl+Alt+Left/Right (Ctrl+Alt+0 resets).
  // When playing on another device (phone, speaker) the desktop only estimates the
  // position, and Bluetooth adds its own lag on top.
  const OFFSET_KEY = "mono:beat-offsets";
  const OFFSET_STEP = 20;
  let offsets = {};
  try {
    offsets = JSON.parse(localStorage.getItem(OFFSET_KEY)) ?? {};
  } catch {}

  const deviceName = () => {
    const d = Spicetify.Platform?.ConnectAPI?.state?.activeDevice;
    return !d || d.isLocal ? "this computer" : d.name;
  };
  const delay = () => offsets[deviceName()] ?? 0;

  // Per-song correction from tapping along (hold Ctrl+Alt, tap B on the beat).
  // The player only knows when a song "started", not when its audio actually came out
  // of the headphones, so each song can be off by a different amount.
  const SONG_OFFSET_KEY = "mono:beat-song-offsets";
  const SONG_OFFSET_MAX = 2000; // songs remembered
  const TAP_GAP_MS = 2500; // a pause longer than this starts a new tap session
  const MIN_TAPS = 4;
  let songOffsets = {};
  try {
    songOffsets = JSON.parse(localStorage.getItem(SONG_OFFSET_KEY)) ?? {};
  } catch {}
  let taps = []; // raw positions (device delay applied, song offset not)
  let lastTapAt = 0;

  const songOffset = () => songOffsets[uri] ?? 0;
  const rawPosition = () => Spicetify.Player.getProgress() - delay();
  const position = () => rawPosition() - songOffset();

  const fmt = (ms) => `${ms > 0 ? "+" : ""}${Math.round(ms)}ms`;
  const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[s.length >> 1];
  };

  function nearestBeat(t) {
    let lo = 0, hi = beats.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (beats[mid] <= t) lo = mid + 1;
      else hi = mid;
    }
    const a = beats[lo - 1], b = beats[lo];
    if (a === undefined) return b;
    if (b === undefined) return a;
    return t - a < b - t ? a : b;
  }

  function tap() {
    if (!beats.length || !uri) return;
    const now = performance.now();
    if (now - lastTapAt > TAP_GAP_MS) taps = [];
    lastTapAt = now;
    taps.push(rawPosition());
    if (taps.length < MIN_TAPS) {
      Spicetify.showNotification(`tap ${taps.length}/${MIN_TAPS}…`);
      return;
    }
    // how far ahead of the beat the player thinks it is when you hear the beat
    const errors = taps.slice(-8).map((t) => t - nearestBeat(t));
    const offset = median(errors);
    const spread = median(errors.map((e) => Math.abs(e - offset)));
    songOffsets[uri] = Math.round(offset);
    const keys = Object.keys(songOffsets);
    if (keys.length > SONG_OFFSET_MAX) delete songOffsets[keys[0]];
    try {
      localStorage.setItem(SONG_OFFSET_KEY, JSON.stringify(songOffsets));
    } catch {}
    seek(position());
    Spicetify.showNotification(`synced to your taps: ${fmt(offset)} (±${Math.round(spread)}ms)`);
  }

  document.addEventListener("keydown", (e) => {
    if (!e.ctrlKey || !e.altKey) return;
    if (e.code === "KeyB") {
      e.preventDefault();
      if (!e.repeat) tap();
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "0"].includes(e.key)) return;
    e.preventDefault();
    const name = deviceName();
    if (e.key === "0") {
      offsets[name] = 0;
      delete songOffsets[uri];
      try {
        localStorage.setItem(SONG_OFFSET_KEY, JSON.stringify(songOffsets));
      } catch {}
    } else {
      offsets[name] = delay() + (e.key === "ArrowRight" ? OFFSET_STEP : -OFFSET_STEP);
    }
    try {
      localStorage.setItem(OFFSET_KEY, JSON.stringify(offsets));
    } catch {}
    Spicetify.showNotification(`beat delay on ${name}: ${fmt(offsets[name])}${e.key === "0" ? " (song tap sync cleared)" : ""}`);
  });

  async function load() {
    const u = (Spicetify.Player.data?.item ?? Spicetify.Player.data?.track)?.uri;
    uri = u;
    beats = [];
    bars = new Set();
    taps = [];
    if (!u?.startsWith("spotify:track:")) return;
    try {
      const data = await Spicetify.getAudioData(u);
      if (uri !== u) return;
      beats = (data.beats ?? []).map((b) => Math.round(b.start * 1000));
      const barStarts = (data.bars ?? []).map((b) => Math.round(b.start * 1000));
      // snap bar starts to the nearest beat so the lookup is exact
      bars = new Set(barStarts.map((s) => beats.reduce((a, b) => (Math.abs(b - s) < Math.abs(a - s) ? b : a), beats[0])));
      seek(position());
    } catch (e) {
      console.warn("[beatSync] no audio analysis", e);
    }
  }

  // index of the first beat after t
  function seek(t) {
    let lo = 0, hi = beats.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (beats[mid] <= t) lo = mid + 1;
      else hi = mid;
    }
    next = lo;
    lastT = t;
  }

  function beat(isBar) {
    const bar = document.querySelector('[data-testid="progress-bar"]');
    if (!bar) return;
    bar.classList.remove("beat-flash", "beat-flash--bar");
    void bar.offsetWidth;
    bar.classList.add(isBar ? "beat-flash--bar" : "beat-flash");
  }

  function frame() {
    requestAnimationFrame(frame);
    if (!beats.length) return;
    const t = position();
    if (t < lastT - 200 || t > lastT + 1000) seek(t); // seeked
    lastT = t;
    while (next < beats.length && beats[next] <= t) {
      if (t - beats[next] < BEAT_WINDOW_MS) beat(bars.has(beats[next]));
      next++;
    }
  }

  Spicetify.Player.addEventListener("songchange", load);
  load();
  requestAnimationFrame(frame);
})();

// BPM pill in song lists (albums, playlists, artist pages, ...).
(async function tracklistBpm() {
  const FEATURES_URL = "https://spclient.wg.spotify.com/audio-attributes/v1/audio-features?format=json&ids=";
  const BATCH = 100;

  while (!window.Spicetify?.CosmosAsync) await new Promise((r) => setTimeout(r, 300));

  const tempos = new Map(); // track id -> bpm, or null if unknown
  const queued = new Set();
  let fetching = false;

  // rows don't carry the track in the DOM, but their React props do
  function rowTrackId(row) {
    const key = Object.keys(row).find((k) => k.startsWith("__reactFiber"));
    let f = row[key];
    for (let depth = 0; f && depth < 6; depth++, f = f.return) {
      const uri = f.memoizedProps?.uri;
      if (typeof uri === "string") return uri.startsWith("spotify:track:") ? uri.split(":")[2] : null;
    }
    return null;
  }

  async function fetchQueued() {
    if (fetching || !queued.size) return;
    fetching = true;
    const ids = [...queued].slice(0, BATCH);
    ids.forEach((id) => queued.delete(id));
    try {
      const res = await Spicetify.CosmosAsync.get(FEATURES_URL + ids.join(","));
      ids.forEach((id) => tempos.set(id, null));
      for (const f of res?.audio_features ?? []) {
        if (f?.id && f.tempo) tempos.set(f.id, Math.round(f.tempo));
      }
    } catch (e) {
      ids.forEach((id) => tempos.set(id, null));
      console.warn("[tracklistBpm] fetch failed", e);
    }
    fetching = false;
    render();
  }

  function render() {
    for (const row of document.querySelectorAll('[role="grid"] [role="row"][aria-rowindex]')) {
      const id = rowTrackId(row);
      if (!id) continue;
      // the column before the duration: "Date added" on playlists, plays on albums/artists
      const cells = row.querySelectorAll('[role="gridcell"]');
      if (cells.length < 4) continue;
      const cell = cells[cells.length - 2];

      if (!tempos.has(id)) queued.add(id);
      // rows get recycled for other tracks while scrolling, so always re-check
      let tag = cell.querySelector(".tl-bpm");
      if (!tag) {
        tag = document.createElement("div");
        tag.className = "tl-bpm";
        cell.prepend(tag);
      }
      if (tag.dataset.id !== id || tag.dataset.bpm !== String(tempos.get(id))) {
        tag.dataset.id = id;
        tag.dataset.bpm = String(tempos.get(id));
        tag.innerHTML = tempos.get(id) ? `${tempos.get(id)}<small>bpm</small>` : "";
      }
    }
    fetchQueued();
  }

  setInterval(render, 500);
})();

// Lyrics icon next to the explicit badge in song lists: accent = timed, grey = plain text.
(async function tracklistLyrics() {
  const LYRICS_URL = "https://spclient.wg.spotify.com/color-lyrics/v2/track/";
  const PARALLEL = 4;
  const RETRY_MS = 60000; // after a failed request (rate limit, offline)
  const CACHE_KEY = "mono:lyrics-sync";
  const CACHE_MAX = 5000;
  const TITLES = { LINE_SYNCED: "Timed lyrics", UNSYNCED: "Lyrics (not timed)" };

  while (!window.Spicetify?.CosmosAsync) await new Promise((r) => setTimeout(r, 300));

  // Spotify's own lyrics (microphone) icon
  const ICON = `<svg viewBox="0 0 16 16" aria-hidden="true">${
    Spicetify.SVGIcons?.lyrics ??
    '<path d="M8.5 1A4.505 4.505 0 004 5.5c0 .731.191 1.411.502 2.022L1.99 13.163a1.307 1.307 0 00.541 1.666l.605.349a1.307 1.307 0 001.649-.283L9.009 9.95C11.248 9.692 13 7.807 13 5.5 13 3.019 10.981 1 8.5 1zM4.023 14.245a.307.307 0 01-.388.066l-.605-.349a.309.309 0 01-.128-.393l2.26-5.078A4.476 4.476 0 007.715 9.92l-3.692 4.325zM8.5 9C6.57 9 5 7.43 5 5.5S6.57 2 8.5 2 12 3.57 12 5.5 10.429 9 8.5 9z"/>'
  }</svg>`;

  // track id -> "LINE_SYNCED" | "UNSYNCED" | "NONE", kept across reloads
  let cache = {};
  try {
    cache = JSON.parse(localStorage.getItem(CACHE_KEY)) ?? {};
  } catch {}
  const failedAt = new Map();
  const queued = new Set();
  let inFlight = 0;
  let saveTimer = null;

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (Object.keys(cache).length > CACHE_MAX) cache = {};
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
      } catch {}
    }, 1000);
  }

  function rowTrackId(row) {
    const key = Object.keys(row).find((k) => k.startsWith("__reactFiber"));
    let f = row[key];
    for (let depth = 0; f && depth < 6; depth++, f = f.return) {
      const uri = f.memoizedProps?.uri;
      if (typeof uri === "string") return uri.startsWith("spotify:track:") ? uri.split(":")[2] : null;
    }
    return null;
  }

  async function fetchOne(id) {
    inFlight++;
    try {
      const body = await Spicetify.CosmosAsync.get(
        `${LYRICS_URL}${id}?format=json&vocalRemoval=false&market=from_token`
      );
      cache[id] = body?.lyrics?.syncType ?? "NONE";
      save();
    } catch {
      failedAt.set(id, Date.now());
    }
    inFlight--;
    pump();
  }

  function pump() {
    for (const id of queued) {
      if (inFlight >= PARALLEL) return;
      queued.delete(id);
      fetchOne(id);
    }
  }

  // Spotify's own badge slot (offline/explicit icons), or ours if the row has none
  function badgeSlot(titleWrap) {
    const native = [...titleWrap.children].find(
      (c) => !c.classList.contains("tl-lyr-slot") && getComputedStyle(c).gridColumnStart === "badges"
    );
    const own = titleWrap.querySelector(":scope > .tl-lyr-slot");
    if (native) {
      own?.remove();
      return native;
    }
    if (own) return own;
    const slot = document.createElement("span");
    slot.className = "tl-lyr-slot";
    titleWrap.append(slot);
    return slot;
  }

  function render() {
    for (const row of document.querySelectorAll('[role="grid"] [role="row"][aria-rowindex]')) {
      const id = rowTrackId(row);
      if (!id) continue;
      const titleCell = row.querySelector('[role="gridcell"][aria-colindex="2"]');
      const titleWrap = titleCell && [...titleCell.querySelectorAll(":scope > *, :scope > * > *")].find(
        (el) => getComputedStyle(el).gridTemplateAreas.includes("badges")
      );
      if (!titleWrap) continue;

      const failed = failedAt.get(id);
      if (!cache[id] && !queued.has(id) && (!failed || Date.now() - failed > RETRY_MS)) queued.add(id);

      const slot = badgeSlot(titleWrap);
      let tag = slot.querySelector(".tl-lyr");
      if (!tag) {
        tag = document.createElement("span");
        tag.className = "tl-lyr";
        slot.prepend(tag);
      }
      const state = cache[id] ?? "";
      // rows get recycled for other tracks while scrolling, so always re-check
      if (tag.dataset.id !== id || tag.dataset.state !== state) {
        tag.dataset.id = id;
        tag.dataset.state = state;
        tag.title = TITLES[state] ?? "";
        tag.innerHTML = TITLES[state] ? ICON : "";
      }
    }
    pump();
  }

  setInterval(render, 500);
})();
