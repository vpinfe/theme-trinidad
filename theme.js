// Trinidad - the playfield picture full screen, an arc of wheels across the top and a panel
// about the selected table.
//
// This file does four things, in this order: read the options, draw the wheel, draw the
// selection, and hand every message to core. Input, audio, preloading, layout, the loading
// indicator, attract mode, turning the page for a sideways screen and the backglass and
// score view pages are core's.

const vpin = new VPinFECore();
window.vpin = vpin;                  // core and its overlays look for this name
window.receiveEvent = receiveEvent;  // core delivers every message through this one

start();

async function start() {
  vpin.init();
  await vpin.ready;                  // the tables, the options and the layout are in

  // Input. Core moves the wheel, pages it and opens the menu and the collection picker.
  // Select is the one action it leaves to a theme.
  vpin.registerInputHandler((action) => {
    if (action === "select") vpin.launchTable(vpin.getCurrentTableIndex());
  });

  document.getElementById("my-rating-label").textContent = vpin.t("frontend.theme.my_rating", "My Rating");
  document.getElementById("counters").setAttribute(
    "aria-label", vpin.t("theme.counters", "Runtime and Start Count"));
  if (option("startCollectionSelection", false)) await vpin.openCollectionPicker();

  draw();
  document.body.dataset.ready = "true";
}

// --- 1. Options ---------------------------------------------------------------------
// options.json declares them and carries their defaults; core merges in what the person
// chose.

function option(key, fallback) {
  const value = vpin.themeConfig ? vpin.themeConfig[key] : undefined;
  return value === undefined ? fallback : value;
}

// --- 2. The wheel -------------------------------------------------------------------
// Up to seven pictures on an arc with the selection in the middle one. A list shorter than
// that shows fewer and keeps the selection in the middle. A picture that is still on
// screen after the wheel moves keeps its element, so it glides to its new place; one that
// leaves slides out past the end of the arc.

const SIDE = 3;
const FADE_MS = 320;

const stage = document.querySelector(".stage");
const wheelsEl = document.getElementById("wheels");
const cards = new Map();

// Where a card sits: x across the stage in cqw, y down it in cqmin.
function place(card, offset) {
  const n = offset / SIDE;
  const set = (name, value) => card.style.setProperty(name, String(value));
  set("--x", n * 43);
  set("--y", 16.5 - (1 - Math.cos(n * Math.PI / 2)) * 5);
  set("--tilt", -n * 14);
  set("--scale", offset === 0 ? 1.18 : 1.02 - Math.abs(offset) * 0.08);
  set("--fade", Math.abs(offset) > SIDE ? 0 : Math.max(0.18, 1 - Math.abs(offset) * 0.14));
  card.dataset.offset = String(offset);
  card.classList.toggle("selected", offset === 0);
}

function drawWheels(list) {
  const picking = list.kind === "collection";
  if (wheelsEl.dataset.kind !== list.kind) {
    wheelsEl.replaceChildren();
    cards.clear();
    wheelsEl.dataset.kind = list.kind;
  }

  const shown = Math.min(2 * SIDE + 1, list.length);
  const before = Math.min(SIDE, Math.floor((shown - 1) / 2));
  const wanted = new Map();
  for (let offset = -before; offset <= shown - 1 - before; offset += 1) {
    const index = list.indexAfter(offset);
    const item = list.items[index];
    wanted.set(picking ? item.label : item.table.id, { index, item, offset });
  }

  for (const [key, card] of cards) {
    if (wanted.has(key)) continue;
    // Leaving: past the end of the arc on the side it was on.
    place(card, Math.sign(Number(card.dataset.offset) || 1) * (SIDE + 1));
    cards.delete(key);
    setTimeout(() => card.remove(), FADE_MS);
  }

  for (const [key, { index, item, offset }] of wanted) {
    let card = cards.get(key);
    if (!card) {
      card = makeCard(list, index, item);
      cards.set(key, card);
      // Entering: it starts past the end of the arc on the side it comes from.
      place(card, Math.sign(offset || 1) * (SIDE + 1));
      wheelsEl.appendChild(card);
      card.offsetWidth;              // so the move to its place is animated
    } else if (Math.abs(offset - Number(card.dataset.offset)) > 2) {
      // A short list wraps: the picture that left one end is wanted at the other. It jumps
      // there unanimated, so it does not slide across the others.
      card.style.transition = "none";
      place(card, Math.sign(offset || 1) * (SIDE + 1));
      card.offsetWidth;
      card.style.transition = "";
    }
    place(card, offset);
  }
}

function makeCard(list, index, item) {
  const picking = list.kind === "collection";
  const card = document.createElement("li");
  const url = picking
    ? item.image_url || (item.game_wheel_urls || [])[0]
    : item.media.includes("wheel") && vpin.getImageURL(index, "wheel");

  if (url) card.appendChild(image(url));
  else {
    const label = document.createElement("span");
    label.className = "wheel-label";
    label.textContent = picking ? item.label : item.game.name;
    card.appendChild(label);
  }
  return card;
}

function image(url) {
  const node = document.createElement("img");
  node.alt = "";
  node.src = url;
  return node;
}

// --- 3. The selection ---------------------------------------------------------------
// Everything about the selected table is on its entry. A collection in the picker is a
// row with a name, a count and pictures.

const titleEl = document.getElementById("title");
const authorsEl = document.getElementById("authors");
const factsEl = document.getElementById("facts");
const myRatingEl = document.getElementById("my-rating");
const communityRatingEl = document.getElementById("community-rating");
const runtimeEl = document.getElementById("runtime");
const startsEl = document.getElementById("starts");
const panelEl = document.getElementById("panel");
const artEl = document.getElementById("art");
const emptyEl = document.getElementById("empty");

function drawSelection(list) {
  const empty = list.length === 0;
  emptyEl.hidden = !empty;
  emptyEl.textContent = vpin.t("frontend.theme.no_tables_found", "No tables found");
  panelEl.hidden = empty;
  if (empty) {
    stage.dataset.view = "tables";
    artFader.clear();
    return;
  }

  const picking = list.kind === "collection";
  stage.dataset.view = picking ? "collections" : "tables";
  if (picking) drawCollection(list.current);
  else drawTable(list.current, list.cursor);

  panelEl.classList.remove("entering");
  panelEl.offsetWidth;
  panelEl.classList.add("entering");
}

panelEl.addEventListener("animationend", () => panelEl.classList.remove("entering"));

function drawTable(entry, index) {
  const { game, table } = entry;
  const user = game.user || {};

  titleEl.textContent = game.name || vpin.t("frontend.theme.unknown_table", "Unknown Table");
  authorsEl.textContent = table.authors.length
    ? table.authors.join(", ")
    : vpin.t("frontend.theme.unknown_author", "Unknown Author");
  drawFacts([game.manufacturer, game.year, game.type]);

  myRatingEl.textContent = stars(user.rating);
  communityRatingEl.textContent = stars(communityRating(entry));
  runtimeEl.textContent = runtime(user.play_time_seconds);
  startsEl.textContent = String(Math.max(0, Math.floor(Number(user.play_count) || 0)));

  drawArt(entry, index);
}

function drawCollection(row) {
  titleEl.textContent = row.label;
  const count = row.table_count;
  authorsEl.textContent = Number.isFinite(count)
    ? vpin.t("theme.tables", { one: "{count} Table", other: "{count} Tables" }, { count })
    : "";
  drawFacts([row.is_filter ? vpin.t("theme.filter", "Filter") : vpin.t("theme.collection", "Collection")]);

  artFader.show("backdrop", () => {
    const node = image("img/collection_background.png");
    node.className = "backdrop";
    return node;
  }, "load");
}

// The manufacturer, year and type, with a dot between the ones the table has.
function drawFacts(parts) {
  factsEl.replaceChildren();
  for (const part of parts.filter(Boolean)) {
    if (factsEl.children.length) factsEl.appendChild(document.createElement("i"));
    const span = document.createElement("span");
    span.textContent = part;
    factsEl.appendChild(span);
  }
}

function stars(rating) {
  const whole = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
  return "★".repeat(whole) + "☆".repeat(5 - whole);
}

// VPinPlay's community rating, which core keeps on the entry: out of five, with the number
// of ratings behind it.
function communityRating(entry) {
  const found = entry.ext && entry.ext.vpinplay;
  if (!found || !(Number(found.ratingCount) > 0)) return 0;
  return Number(found.cumulativeRating) || 0;
}

// Whole minutes under an hour, then hours.
function runtime(seconds) {
  const minutes = Math.floor((Number(seconds) || 0) / 60);
  if (minutes < 60) return vpin.t("theme.minutes_short", "{count}m", { count: Math.max(0, minutes) });
  const hours = minutes / 60;
  return vpin.t("theme.hours_short", "{count}h", {
    count: Number.isInteger(hours) ? hours : hours.toFixed(1),
  });
}

// The art. A fader holds the picture on screen. A new one loads at the back and fades in
// over the one already there; a later one supersedes it, so a slow load for a table no
// longer selected never shows. Asking for the picture already showing changes nothing, so
// a video is not restarted by a message that leaves the selection where it was.

function makeFader(container) {
  let token = 0;
  let shownKey = null;

  function clear() {
    token += 1;
    shownKey = null;
    for (const layer of container.querySelectorAll(".layer")) retire(layer);
  }

  // `make` builds the node; it waits, invisible, until `event` says it has something to show.
  function show(key, make, event) {
    if (key === shownKey) return;
    shownKey = key;
    token += 1;
    const mine = token;
    for (const layer of container.querySelectorAll(".entering")) discard(layer);

    const node = make();
    const layer = document.createElement("div");
    layer.className = "layer entering";
    layer.appendChild(node);
    container.appendChild(layer);

    const reveal = () => {
      if (mine !== token || !layer.isConnected) return;
      for (const old of container.querySelectorAll(".layer:not(.entering):not(.exiting)")) {
        if (old !== layer) retire(old);
      }
      layer.offsetWidth;             // so the fade starts from the hidden look
      layer.classList.remove("entering");
    };
    // A picture that cannot be loaded leaves the screen black, so the one before it does
    // not stay up under another table's name.
    const failed = () => {
      if (mine !== token || !layer.isConnected) return;
      clear();
    };
    node.addEventListener(event, reveal, { once: true });
    node.addEventListener("error", failed, { once: true });
  }

  return { show, clear };
}

function retire(layer) {
  layer.classList.add("exiting");
  setTimeout(() => discard(layer), FADE_MS);
}

// A removed video keeps its connection open until it is told to let go.
function discard(layer) {
  for (const video of layer.querySelectorAll("video")) {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
  layer.remove();
}

const artFader = makeFader(artEl);

// The playfield video when the table has one, else its picture.
function drawArt(entry, index) {
  const video = entry.media.includes("playfield_video");
  const still = ["playfield", "playfield_fss"].find((kind) => entry.media.includes(kind));
  if (!video && !still) {
    artFader.clear();
    return;
  }

  // getMediaURL could answer with the still; getVideoURL is always the video. getImageURL
  // has no FSS fallback, so a table with only an FSS picture is asked for it by name.
  const url = video ? vpin.getVideoURL(index, "playfield") : vpin.getImageURL(index, still);
  artFader.show(url, () => {
    let node;
    if (video) {
      node = document.createElement("video");
      Object.assign(node, { src: url, autoplay: true, loop: true, muted: true, playsInline: true });
    } else {
      node = image(url);
    }
    // Core measures the art against the screen and sets how far to turn it; style.css fits
    // the turned picture to the stage.
    vpin.applyPlayfieldMediaRotation(node);
    return node;
  }, video ? "loadeddata" : "load");
}

// --- 4. Messages --------------------------------------------------------------------
// Core needs to see every message first: it keeps the selection, the audio and the
// loading indicator in step with them. After that the theme draws.

async function receiveEvent(message) {
  await vpin.handleEvent(message);

  if (message.type === "TableIndexUpdate" || message.type === "TableDataChange") draw();
}

function draw() {
  const list = vpin.activeList();
  drawSelection(list);
  if (list.length > 0) drawWheels(list);
  else {
    wheelsEl.replaceChildren();
    cards.clear();
  }
}
