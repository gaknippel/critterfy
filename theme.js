// shows the current synced lyric line in the now-playing bar, to the right of the
(async function npbLyrics() {
  const LYRICS_URL = "https://spclient.wg.spotify.com/color-lyrics/v2/track/";
  const FPS = 12; 
  const SPIN_FRAMES = 3; // frames every reel spins before the first one stops
  const STOP_FRAMES = 9; // frames over which the reels stop, left to right
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
  let spinTimer = null;

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
    clearInterval(spinTimer);
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

    const stopAt = reels.map((_, k) => SPIN_FRAMES + Math.floor((k * Math.min(reels.length, STOP_FRAMES)) / reels.length));
    let frame = 0;
    el.classList.add("npb-lyric--spinning");
    place();

    if (el.classList.contains("npb-lyric--overflow")) {
      const landMs = (stopAt[stopAt.length - 1] / FPS) * 1000 + 330;
      const lineMs = (lines[i + 1]?.start ?? line.start + 5000) - line.start;
      const scrollMs = Math.max(800, (lineMs - landMs) * 0.8);
      const steps = Math.max(1, Math.round((scrollMs / 1000) * FPS));
      track.style.animation = `npb-scroll ${scrollMs}ms steps(${steps}) ${landMs}ms both`;
    }

    spinTimer = setInterval(() => {
      frame++;
      reels.forEach((r, k) => {
        if (!r.s.classList.contains("npb-ch--spin")) return;
        if (frame >= stopAt[k]) {
          r.s.textContent = r.c;
          r.s.style.animationDelay = "";
          r.s.className = "npb-ch npb-ch--land";
        } else {
          r.s.textContent = randomGlyph();
        }
      });
      if (frame >= stopAt[stopAt.length - 1]) {
        clearInterval(spinTimer);
        el.classList.remove("npb-lyric--spinning");
        restartClass(el, "npb-lyric--thunk");
      }
    }, 1000 / FPS);
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
