// ===========================================================================
// TripCraft AI — frontend
// ===========================================================================
const STORAGE_KEY = "tripcraft.trips.v1";
const DRAFT_KEY = "tripcraft.draft.v1";
const STEP_LABELS = ["Destination", "Dates", "Budget", "Travelers", "Pace", "Interests", "Stay", "Notes", "Review"];
const SURPRISE = ["Hoi An, Vietnam", "Lisbon, Portugal", "Udaipur, India", "Cape Town, South Africa",
  "Tbilisi, Georgia", "Hokkaido, Japan", "Rishikesh, India", "Mexico City, Mexico", "Seoul, South Korea",
  "Ljubljana, Slovenia", "Leh-Ladakh, India", "Marrakech, Morocco"];

const emptyData = () => ({
  destination: "", origin: "", duration: 5, start_date: "", travelers: 1,
  budget: "", traveler_type: "", pace: "", interests: [], notes: "",
  accommodation: "", local_transport: "", dest_coords: null
});

const state = {
  step: 1,
  maxStepReached: 1,
  totalSteps: 9,
  data: emptyData(),
  itinerary: null,
  tripId: null,
  history: [],          // undo stack of previous itineraries
  extras: {},           // per-trip add-ons: packing, expenses, essentials, chat…
  abort: null,
  busy: false,
};

const $ = (id) => document.getElementById(id);
const els = {
  wizard: $("wizard"), loading: $("loading"), results: $("results"),
  progressBar: $("progressBar"), progressSteps: $("progressSteps"), stepDots: $("stepDots"),
  wizardError: $("wizardError"), prevBtn: $("prevBtn"), nextBtn: $("nextBtn"), generateBtn: $("generateBtn"),
  destination: $("destination"), duration: $("duration"), startDate: $("startDate"), endDateHint: $("endDateHint"),
  travelers: $("travelers"), notes: $("notes"), origin: $("origin"),
  logistics: $("logisticsSection"), reviewSummary: $("reviewSummary"),
  ollamaStatus: $("ollamaStatus"),
  loadingText: $("loadingText"), loadingStage: $("loadingStage"), loadingTimer: $("loadingTimer"),
  genBar: $("genBar"), cancelBtn: $("cancelBtn"),
  resultTitle: $("resultTitle"), resultBadges: $("resultBadges"), resultSummary: $("resultSummary"),
  resultTotal: $("resultTotal"), dayNav: $("dayNav"), daysContainer: $("daysContainer"),
  tipsCard: $("tipsCard"), tipsList: $("tipsList"),
  downloadPdfBtn: $("downloadPdfBtn"), icsBtn: $("icsBtn"), copyBtn: $("copyBtn"), undoBtn: $("undoBtn"),
  startOverBtn: $("startOverBtn"),
  customizeInput: $("customizeInput"), customizeBtn: $("customizeBtn"), customizeError: $("customizeError"),
  myTripsBtn: $("myTripsBtn"), tripCount: $("tripCount"), tripsPanel: $("tripsPanel"),
  tripsList: $("tripsList"), closeTripsBtn: $("closeTripsBtn"),
  dayDialog: $("dayDialog"), dayDialogTitle: $("dayDialogTitle"), dayInstruction: $("dayInstruction"),
  toast: $("toast"),
};

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}
let toastTimer;
function toast(msg, kind = "info") {
  els.toast.textContent = msg;
  els.toast.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 3200);
}
const storage = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  },
};
function parseISODate(s) {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(date, n) { const d = new Date(date); d.setDate(d.getDate() + n); return d; }
function fmtDate(date, opts = { weekday: "short", day: "numeric", month: "short" }) {
  return date.toLocaleDateString(undefined, opts);
}
function dayDate(dayNum) {
  const start = parseISODate(state.itinerary?._meta?.start_date);
  return start ? addDays(start, dayNum - 1) : null;
}
function mapsSearchUrl(query) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
function mapsRouteUrl(day) {
  const dest = state.itinerary.destination || "";
  const stops = (day.activities || []).map(a => `${a.activity}, ${dest}`).slice(0, 10);
  if (stops.length < 2) return mapsSearchUrl(stops[0] || dest);
  const params = new URLSearchParams({
    api: "1", travelmode: "transit",
    origin: stops[0], destination: stops[stops.length - 1],
    waypoints: stops.slice(1, -1).join("|"),
  });
  return `https://www.google.com/maps/dir/?${params}`;
}
function cleanForAI(it) {
  const { _meta, ...rest } = JSON.parse(JSON.stringify(it));
  rest.days?.forEach(d => d.activities?.forEach(a => delete a._done));
  return rest;
}
function setBusy(b) {
  state.busy = b;
  document.querySelectorAll("[data-busy-disable]").forEach(x => x.disabled = b);
  els.customizeBtn.disabled = b;
}

// ---------------------------------------------------------------------------
// AI status badge
// ---------------------------------------------------------------------------
async function checkOllamaStatus() {
  const text = els.ollamaStatus.querySelector(".status-text");
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    const ok = data.ai_available ?? data.ollama_reachable;
    els.ollamaStatus.classList.toggle("online", ok);
    els.ollamaStatus.classList.toggle("offline", !ok);
    els.ollamaStatus.title = `Model: ${data.model}${data.backup_provider ? ` (backup: ${data.backup_provider})` : ""}`;
    if (ok) text.textContent = "AI ready";
    else text.textContent = data.using_cloud && !data.api_key_set ? "AI offline — API key missing" : "AI offline";
  } catch {
    els.ollamaStatus.classList.add("offline");
    text.textContent = "Server waking up…";
    setTimeout(checkOllamaStatus, 8000); // Render free tier cold start
  }
}

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------
function renderStepDots() {
  els.stepDots.innerHTML = STEP_LABELS.map((label, i) => {
    const n = i + 1;
    const cls = n === state.step ? "current" : n <= state.maxStepReached ? "done" : "";
    return `<li><button type="button" class="dot-btn ${cls}" data-step="${n}" title="${label}"
      ${n > state.maxStepReached ? "disabled" : ""} aria-label="Step ${n}: ${label}"></button></li>`;
  }).join("");
}

function showStep(n) {
  state.step = n;
  state.maxStepReached = Math.max(state.maxStepReached, n);
  document.querySelectorAll(".step").forEach(s => {
    s.classList.toggle("active", parseInt(s.dataset.step, 10) === n);
  });
  els.progressBar.style.width = `${(n / state.totalSteps) * 100}%`;
  els.progressSteps.textContent = `Step ${n} of ${state.totalSteps} · ${STEP_LABELS[n - 1]}`;
  els.prevBtn.style.visibility = n === 1 ? "hidden" : "visible";
  els.nextBtn.style.display = n === state.totalSteps ? "none" : "inline-block";
  els.generateBtn.style.display = n === state.totalSteps ? "inline-block" : "none";
  hideWizardError();
  renderStepDots();
  if (n === state.totalSteps) renderReview();
  const focusable = document.querySelector(`.step[data-step="${n}"] input, .step[data-step="${n}"] textarea`);
  if (focusable && window.matchMedia("(min-width: 700px)").matches) focusable.focus();
}

function showWizardError(msg) {
  els.wizardError.textContent = msg;
  els.wizardError.style.display = "block";
}
function hideWizardError() { els.wizardError.style.display = "none"; }

function readInputs() {
  state.data.destination = els.destination.value.trim();
  state.data.origin = els.origin.value.trim();
  state.data.duration = parseInt(els.duration.value, 10) || 0;
  state.data.start_date = els.startDate.value || "";
  state.data.travelers = parseInt(els.travelers.value, 10) || 1;
  state.data.notes = els.notes.value.trim();
  storage.set(DRAFT_KEY, state.data);
}

function validateStep(n) {
  readInputs();
  const d = state.data;
  switch (n) {
    case 1: if (!d.destination) return "Please enter a destination."; break;
    case 2:
      if (!d.duration || d.duration < 1 || d.duration > 30) return "Trip length must be between 1 and 30 days.";
      if (d.start_date && parseISODate(d.start_date) < new Date(new Date().toDateString()))
        return "Start date is in the past.";
      break;
    case 3: if (!d.budget) return "Please select a budget."; break;
    case 4: if (!d.traveler_type) return "Please select who's traveling."; break;
    case 5: if (!d.pace) return "Please select a pace."; break;
    case 6: if (d.interests.length === 0) return "Please select at least one interest."; break;
  }
  return null;
}

function goNext() {
  const err = validateStep(state.step);
  if (err) { showWizardError(err); return; }
  if (state.step < state.totalSteps) showStep(state.step + 1);
}
els.nextBtn.addEventListener("click", goNext);
els.prevBtn.addEventListener("click", () => { readInputs(); if (state.step > 1) showStep(state.step - 1); });
els.stepDots.addEventListener("click", (e) => {
  const b = e.target.closest(".dot-btn");
  if (!b || b.disabled) return;
  readInputs();
  showStep(parseInt(b.dataset.step, 10));
});

// Enter advances (Ctrl/Cmd+Enter inside the notes textarea)
els.wizard.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.isComposing) return;
  if (e.target.tagName === "TEXTAREA" && !(e.ctrlKey || e.metaKey)) return;
  if (e.target.tagName === "BUTTON") return; // let buttons handle their own Enter
  e.preventDefault();
  if (state.step === state.totalSteps) generate(); else goNext();
});
document.getElementById("wizardForm").addEventListener("submit", e => e.preventDefault());

// Steppers
function bindStepper(input, minus, plus, min, max) {
  $(minus).addEventListener("click", () => { input.value = Math.max(min, (parseInt(input.value, 10) || min) - 1); input.dispatchEvent(new Event("input")); });
  $(plus).addEventListener("click", () => { input.value = Math.min(max, (parseInt(input.value, 10) || min) + 1); input.dispatchEvent(new Event("input")); });
}
bindStepper(els.duration, "durationMinus", "durationPlus", 1, 30);
bindStepper(els.travelers, "travelersMinus", "travelersPlus", 1, 20);

function updateEndDateHint() {
  const start = parseISODate(els.startDate.value);
  const n = parseInt(els.duration.value, 10);
  els.endDateHint.textContent = start && n > 0
    ? `${fmtDate(start)} → ${fmtDate(addDays(start, n - 1))}` : "";
}
els.startDate.min = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
els.startDate.addEventListener("input", updateEndDateHint);
els.duration.addEventListener("input", updateEndDateHint);

// Destination chips
document.querySelectorAll(".dest-chip").forEach(chip => {
  chip.addEventListener("click", () => {
    const v = chip.textContent.includes("Surprise")
      ? SURPRISE[Math.floor(Math.random() * SURPRISE.length)] : chip.textContent;
    els.destination.value = v;
    state.data.dest_coords = null;
    hideWizardError();
    setTimeout(goNext, 150);
  });
});

// Option cards (single-select auto-advances)
function syncOptionCards() {
  document.querySelectorAll(".option-grid").forEach(grid => {
    const field = grid.dataset.field;
    grid.querySelectorAll(".option-card").forEach(card => {
      const v = card.dataset.value;
      const on = field === "interests" ? state.data.interests.includes(v) : state.data[field] === v;
      card.classList.toggle("selected", on);
      card.setAttribute("aria-pressed", on);
    });
  });
}
document.querySelectorAll(".option-grid").forEach(grid => {
  const field = grid.dataset.field;
  const isMulti = grid.dataset.multi === "true";
  const isOptional = grid.dataset.optional === "true";
  grid.querySelectorAll(".option-card").forEach(card => {
    card.addEventListener("click", () => {
      const value = card.dataset.value;
      if (isMulti) {
        const set = new Set(state.data.interests);
        set.has(value) ? set.delete(value) : set.add(value);
        state.data.interests = [...set];
      } else if (isOptional) {
        state.data[field] = state.data[field] === value ? "" : value; // click again to clear
      } else {
        state.data[field] = value;
      }
      syncOptionCards();
      renderIdeaInterests();
      storage.set(DRAFT_KEY, state.data);
      hideWizardError();
      if (!isMulti && !isOptional) setTimeout(goNext, 220);
    });
  });
});

function renderReview() {
  const d = state.data;
  const start = parseISODate(d.start_date);
  const rows = [
    ["Destination", d.destination, 1],
    ["From", d.origin || "Not specified", 2],
    ["Duration", `${d.duration} day${d.duration > 1 ? "s" : ""}`, 2],
    ["Dates", start ? `${fmtDate(start)} → ${fmtDate(addDays(start, d.duration - 1))}` : "Flexible", 2],
    ["Travelers", d.travelers, 2],
    ["Budget", d.budget, 3],
    ["Traveler type", d.traveler_type, 4],
    ["Pace", d.pace, 5],
    ["Interests", d.interests.join(", "), 6],
    ["Stay", d.accommodation || "No preference", 7],
    ["Getting around", d.local_transport || "No preference", 7],
    ["Notes", d.notes || "—", 8],
  ];
  els.reviewSummary.innerHTML = rows.map(([label, value, step]) => `
    <button type="button" class="review-row" data-goto="${step}">
      <span class="label">${label}</span><span class="value">${escapeHtml(value)}</span><span class="edit">✎</span>
    </button>`).join("");
}
els.reviewSummary.addEventListener("click", e => {
  const row = e.target.closest("[data-goto]");
  if (row) showStep(parseInt(row.dataset.goto, 10));
});

function restoreWizard(data) {
  state.data = { ...emptyData(), ...data };
  els.destination.value = state.data.destination;
  els.origin.value = state.data.origin || "";
  els.duration.value = state.data.duration;
  els.startDate.value = state.data.start_date || "";
  els.travelers.value = state.data.travelers || 1;
  els.notes.value = state.data.notes;
  syncOptionCards();
  updateEndDateHint();
}

// ---------------------------------------------------------------------------
// Streaming AI calls (NDJSON)
// ---------------------------------------------------------------------------
let timerHandle;
function startLoading(title, expectedDays) {
  els.loadingText.textContent = title;
  els.loadingStage.textContent = "Contacting the AI…";
  els.genBar.style.width = "3%";
  const t0 = Date.now();
  els.loadingTimer.textContent = "0s";
  clearInterval(timerHandle);
  timerHandle = setInterval(() => {
    els.loadingTimer.textContent = `${Math.round((Date.now() - t0) / 1000)}s`;
  }, 1000);
  els.wizard.style.display = "none";
  els.results.style.display = "none";
  els.tripsPanel.style.display = "none";
  els.loading.style.display = "block";
  state.expectedDays = expectedDays;
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function stopLoading() {
  clearInterval(timerHandle);
  els.loading.style.display = "none";
}
function onProgress(ev) {
  const total = state.expectedDays || 1;
  const seen = Math.min(ev.days_seen || 0, total);
  // Day markers appear as each day *starts*, so the current day = seen.
  const pct = seen === 0 ? Math.min(12, 3 + ev.chars / 300) : 10 + (seen / total) * 85;
  els.genBar.style.width = `${Math.min(97, pct)}%`;
  els.loadingStage.textContent = seen === 0
    ? "Sketching the overall plan…"
    : `Planning day ${seen} of ${total}…`;
}

async function streamItinerary(url, body) {
  state.abort = new AbortController();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: state.abort.signal,
  });
  if (!res.ok) {
    let msg = `Request failed (HTTP ${res.status}).`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const ev = JSON.parse(line);
      if (ev.type === "progress") onProgress(ev);
      else if (ev.type === "error") throw new Error(ev.error);
      else if (ev.type === "done") return ev.itinerary;
    }
  }
  throw new Error("The connection closed before the plan was finished. Please try again.");
}

els.cancelBtn.addEventListener("click", () => state.abort?.abort());

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------
async function generate() {
  for (let s = 1; s < state.totalSteps; s++) {
    const err = validateStep(s);
    if (err) { showStep(s); showWizardError(err); return; }
  }
  if (state.busy) return;
  setBusy(true);
  startLoading(`Planning ${state.data.duration} days in ${state.data.destination}…`, state.data.duration);
  try {
    const it = await streamItinerary("/api/generate-itinerary/stream", state.data);
    it._meta = { start_date: state.data.start_date, travelers: state.data.travelers, origin: state.data.origin,
      coords: state.data.dest_coords, origin_cc: state.data.origin_cc, request: { ...state.data } };
    state.itinerary = it;
    state.tripId = `t${Date.now()}`;
    state.history = [];
    state.extras = {};
    saveTrip();
    stopLoading();
    showResults();
    toast("Itinerary ready ✓", "success");
  } catch (e) {
    stopLoading();
    els.wizard.style.display = "block";
    showWizardError(e.name === "AbortError" ? "Generation cancelled." : e.message);
  } finally {
    setBusy(false);
  }
}
els.generateBtn.addEventListener("click", generate);

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------
function showResults() {
  renderResults();
  els.wizard.style.display = "none";
  els.tripsPanel.style.display = "none";
  els.results.style.display = "block";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderResults() {
  const it = state.itinerary;
  const meta = it._meta || {};
  els.resultTitle.textContent = `${it.destination} · ${it.duration_days} day${it.duration_days > 1 ? "s" : ""}`;
  const start = parseISODate(meta.start_date);
  const badges = [
    start && `📅 ${fmtDate(start)} – ${fmtDate(addDays(start, it.duration_days - 1))}`,
    meta.origin && `🛫 from ${meta.origin}`,
    meta.travelers && `👥 ${meta.travelers} traveler${meta.travelers > 1 ? "s" : ""}`,
    it.budget && `💰 ${it.budget}`, it.traveler_type && `🧳 ${it.traveler_type}`, it.pace && `⏱ ${it.pace}`,
  ].filter(Boolean);
  els.resultBadges.innerHTML = badges.map(b => `<span class="badge">${escapeHtml(b)}</span>`).join("");
  els.resultSummary.textContent = it.summary || "";
  els.resultTotal.innerHTML = [
    it.estimated_total_cost && `<strong>Per person:</strong> ${escapeHtml(it.estimated_total_cost)}`,
    it.estimated_group_total && (meta.travelers > 1) && `<strong>Group of ${meta.travelers}:</strong> ${escapeHtml(it.estimated_group_total)}`,
  ].filter(Boolean).join(" &nbsp;·&nbsp; ");
  els.undoBtn.disabled = state.history.length === 0;

  els.dayNav.innerHTML = (it.days || []).map(day => {
    const dd = dayDate(day.day);
    return `<a href="#day-${day.day}" class="day-pill">Day ${day.day}${dd ? `<small>${fmtDate(dd, { day: "numeric", month: "short" })}</small>` : ""}</a>`;
  }).join("");

  els.daysContainer.innerHTML = (it.days || []).map(day => {
    const dd = dayDate(day.day);
    return `
    <article class="day-card" id="day-${day.day}">
      <header class="day-head">
        <button type="button" class="collapse-btn" data-collapse="${day.day}" aria-expanded="true" aria-label="Collapse day ${day.day}">▾</button>
        <span class="day-num">DAY ${day.day}</span>
        <div class="day-title">
          <h3>${escapeHtml(day.title || "")}</h3>
          ${dd ? `<span class="day-date">${fmtDate(dd, { weekday: "long", day: "numeric", month: "long" })}</span>` : ""}
        </div>
        ${day.estimated_day_cost ? `<span class="day-cost">~${escapeHtml(day.estimated_day_cost)}</span>` : ""}
      </header>
      <div class="day-body">
        ${(day.activities || []).map((act, ai) => `
          <div class="activity ${act._done ? "done" : ""}">
            <div class="time">${escapeHtml(act.time || "")}</div>
            <div>
              <div class="act-tools">
                <button type="button" class="icon-btn" data-done="${day.day}:${ai}" title="${act._done ? "Mark as not done" : "Mark as done"}" aria-label="Toggle done">${act._done ? "✓" : "○"}</button>
                <button type="button" class="icon-btn" data-remove="${day.day}:${ai}" title="Remove from plan" aria-label="Remove activity">✕</button>
              </div>
              <p class="activity-name">${escapeHtml(act.activity || "")}
                <a class="map-link" target="_blank" rel="noopener" href="${mapsSearchUrl(`${act.activity}, ${it.destination}`)}" title="Open in Google Maps">📍 Map</a>
              </p>
              ${act.description ? `<p class="activity-desc">${escapeHtml(act.description)}</p>` : ""}
              <p class="activity-meta">
                ${act.location ? `<span>🧭 ${escapeHtml(act.location)}</span>` : ""}
                ${act.duration_estimate ? `<span>⏱ ${escapeHtml(act.duration_estimate)}</span>` : ""}
                ${act.cost_estimate ? `<span>💵 ${escapeHtml(act.cost_estimate)}</span>` : ""}
              </p>
            </div>
          </div>`).join("")}
        ${(day.meals && day.meals.length) ? `
          <div class="meals-row">
            ${day.meals.map(m => `
              <div class="meal-chip">
                <strong>${escapeHtml(m.meal || "Meal")}:</strong> ${escapeHtml(m.suggestion || "")}
                <a class="map-link" target="_blank" rel="noopener" href="${mapsSearchUrl(`${m.suggestion}, ${it.destination}`)}">📍</a>
                ${m.description ? `<span class="meal-desc">${escapeHtml(m.description)}</span>` : ""}
                ${m.cost_estimate ? `<span class="meal-cost">${escapeHtml(m.cost_estimate)}</span>` : ""}
              </div>`).join("")}
          </div>` : ""}
        <div class="day-actions">
          <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="${mapsRouteUrl(day)}">🗺 Day route</a>
          <button type="button" class="btn btn-ghost btn-sm" data-replan="${day.day}" data-busy-disable>↻ Replan day</button>
        </div>
      </div>
    </article>`;
  }).join("");

  renderLogistics();

  if (it.tips && it.tips.length) {
    els.tipsList.innerHTML = it.tips.map(t => `<li>${escapeHtml(t)}</li>`).join("");
    els.tipsCard.style.display = "block";
  } else {
    els.tipsCard.style.display = "none";
  }
  window.onResultsRendered?.();
}

els.daysContainer.addEventListener("click", (e) => {
  const c = e.target.closest("[data-collapse]");
  if (c) {
    const card = c.closest(".day-card");
    const collapsed = card.classList.toggle("collapsed");
    c.setAttribute("aria-expanded", !collapsed);
    return;
  }
  const r = e.target.closest("[data-replan]");
  if (r) { openReplan(parseInt(r.dataset.replan, 10)); return; }
  const done = e.target.closest("[data-done]");
  const rm = e.target.closest("[data-remove]");
  if (done || rm) {
    const [d, a] = (done || rm).dataset[done ? "done" : "remove"].split(":").map(Number);
    const acts = state.itinerary.days[d - 1].activities;
    if (rm) { pushHistory(); const [gone] = acts.splice(a, 1); toast(`Removed “${gone.activity}” — Undo to restore`); }
    else acts[a]._done = !acts[a]._done;
    saveTrip();
    const y = window.scrollY;
    renderResults();
    window.scrollTo(0, y);
  }
});

// ---------------------------------------------------------------------------
// History / undo
// ---------------------------------------------------------------------------
function pushHistory() {
  state.history.push(JSON.parse(JSON.stringify(state.itinerary)));
  if (state.history.length > 10) state.history.shift();
}
els.undoBtn.addEventListener("click", () => {
  if (!state.history.length) return;
  state.itinerary = state.history.pop();
  saveTrip();
  renderResults();
  toast("Reverted last change");
});

// ---------------------------------------------------------------------------
// Customize whole trip
// ---------------------------------------------------------------------------
async function applyCustomization(text) {
  text = (text || "").trim();
  if (!text || state.busy) return;
  els.customizeError.style.display = "none";
  setBusy(true);
  const meta = state.itinerary._meta;
  startLoading(`Updating your trip: “${text}”`, state.itinerary.days.length);
  try {
    const clean = cleanForAI(state.itinerary);
    const updated = await streamItinerary("/api/customize-itinerary/stream", { itinerary: clean, request: text });
    pushHistory();
    updated._meta = meta;
    state.itinerary = updated;
    saveTrip();
    els.customizeInput.value = "";
    stopLoading();
    showResults();
    toast("Trip updated ✓ — Undo is available", "success");
  } catch (e) {
    stopLoading();
    els.results.style.display = "block";
    els.customizeError.textContent = e.name === "AbortError" ? "Update cancelled." : e.message;
    els.customizeError.style.display = "block";
    els.customizeError.scrollIntoView({ behavior: "smooth", block: "center" });
  } finally {
    setBusy(false);
  }
}
els.customizeBtn.addEventListener("click", () => applyCustomization(els.customizeInput.value));
els.customizeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") applyCustomization(els.customizeInput.value);
});
document.querySelectorAll(".customize-examples .chip").forEach(chip => {
  chip.addEventListener("click", () => { els.customizeInput.value = chip.textContent; els.customizeInput.focus(); });
});

// ---------------------------------------------------------------------------
// Replan a single day
// ---------------------------------------------------------------------------
let replanDay = null;
function openReplan(n) {
  if (state.busy) return;
  replanDay = n;
  els.dayDialogTitle.textContent = `Replan day ${n}`;
  els.dayInstruction.value = "";
  els.dayDialog.showModal();
}
els.dayDialog.addEventListener("close", async () => {
  if (els.dayDialog.returnValue !== "ok" || replanDay == null) return;
  const n = replanDay;
  const card = document.getElementById(`day-${n}`);
  card?.classList.add("regenerating");
  setBusy(true);
  try {
    const clean = cleanForAI(state.itinerary);
    const res = await fetch("/api/regenerate-day", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itinerary: clean, day: n, request: els.dayInstruction.value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not replan this day.");
    pushHistory();
    state.itinerary.days[n - 1] = data.day;
    saveTrip();
    renderResults();
    document.getElementById(`day-${n}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    toast(`Day ${n} replanned ✓`, "success");
  } catch (e) {
    card?.classList.remove("regenerating");
    toast(e.message, "error");
  } finally {
    setBusy(false);
  }
});

// ---------------------------------------------------------------------------
// Saved trips (localStorage)
// ---------------------------------------------------------------------------
function loadTrips() { return storage.get(STORAGE_KEY, []); }
function saveTrip() {
  if (!state.itinerary) return;
  const trips = loadTrips().filter(t => t.id !== state.tripId);
  trips.unshift({ id: state.tripId, savedAt: Date.now(), itinerary: state.itinerary, extras: state.extras });
  if (!storage.set(STORAGE_KEY, trips.slice(0, 15))) toast("Couldn't save trip (browser storage full)", "error");
  refreshTripsButton();
}
function refreshTripsButton() {
  const n = loadTrips().length;
  els.myTripsBtn.style.display = n ? "inline-flex" : "none";
  els.tripCount.textContent = n;
}
function renderTrips() {
  const trips = loadTrips();
  els.tripsList.innerHTML = trips.length ? trips.map(t => {
    const it = t.itinerary;
    return `<div class="trip-row">
      <button type="button" class="trip-open" data-open="${t.id}">
        <strong>${escapeHtml(it.destination)}</strong>
        <span>${it.duration_days} days · ${escapeHtml(it.budget || "")} · saved ${new Date(t.savedAt).toLocaleDateString()}</span>
      </button>
      <button type="button" class="btn btn-ghost btn-sm" data-del="${t.id}" aria-label="Delete trip">🗑</button>
    </div>`;
  }).join("") : `<p class="step-sub">No saved trips yet.</p>`;
}
els.myTripsBtn.addEventListener("click", () => {
  if (state.busy) return;
  renderTrips();
  els.wizard.style.display = "none";
  els.results.style.display = "none";
  els.tripsPanel.style.display = "block";
});
els.closeTripsBtn.addEventListener("click", () => {
  els.tripsPanel.style.display = "none";
  if (state.itinerary) showResults(); else els.wizard.style.display = "block";
});
els.tripsList.addEventListener("click", (e) => {
  const open = e.target.closest("[data-open]");
  const del = e.target.closest("[data-del]");
  if (open) {
    const t = loadTrips().find(x => x.id === open.dataset.open);
    if (!t) return;
    state.itinerary = t.itinerary;
    state.tripId = t.id;
    state.history = [];
    state.extras = t.extras || {};
    showResults();
  } else if (del) {
    if (!confirmDelete()) return;
    storage.set(STORAGE_KEY, loadTrips().filter(x => x.id !== del.dataset.del));
    if (state.tripId === del.dataset.del) { state.itinerary = null; state.tripId = null; }
    renderTrips();
    refreshTripsButton();
    if (!loadTrips().length) els.closeTripsBtn.click();
  }
});
function confirmDelete() {
  // Inline double-click confirmation instead of a blocking confirm() dialog.
  const now = Date.now();
  if (confirmDelete.last && now - confirmDelete.last < 2500) { confirmDelete.last = 0; return true; }
  confirmDelete.last = now;
  toast("Tap delete again to confirm");
  return false;
}

// ---------------------------------------------------------------------------
// New trip
// ---------------------------------------------------------------------------
els.startOverBtn.addEventListener("click", () => {
  if (state.busy) return;
  state.itinerary = null;
  state.tripId = null;
  state.history = [];
  state.extras = {};
  state.maxStepReached = 1;
  restoreWizard(emptyData());
  storage.set(DRAFT_KEY, state.data);
  els.results.style.display = "none";
  els.wizard.style.display = "block";
  showStep(1);
});

// ---------------------------------------------------------------------------
// Export: plain text, calendar (.ics), PDF
// ---------------------------------------------------------------------------
function itineraryAsText() {
  const it = state.itinerary;
  const lines = [`${it.destination} — ${it.duration_days} day itinerary`, ""];
  if (it.summary) lines.push(it.summary, "");
  if (it.estimated_total_cost) lines.push(`Estimated total (per person): ${it.estimated_total_cost}`, "");
  it.days.forEach(day => {
    const dd = dayDate(day.day);
    lines.push(`DAY ${day.day}${dd ? ` (${fmtDate(dd)})` : ""}: ${day.title || ""}`);
    day.activities.forEach(a => lines.push(`  • ${a.time ? a.time + " — " : ""}${a.activity}${a.cost_estimate ? ` [${a.cost_estimate}]` : ""}`));
    day.meals.forEach(m => lines.push(`  🍽 ${m.meal}: ${m.suggestion}`));
    lines.push("");
  });
  if (it.getting_there?.length) {
    lines.push("Getting there:");
    it.getting_there.forEach(g => lines.push(`  • ${g.mode}: ${g.route || ""} — ${g.duration || "?"}, ${g.fare_estimate || "?"}`));
    lines.push("");
  }
  if (it.tips.length) { lines.push("Tips:"); it.tips.forEach(t => lines.push(`  - ${t}`)); }
  return lines.join("\n");
}
els.copyBtn.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(itineraryAsText()); toast("Copied to clipboard ✓", "success"); }
  catch { toast("Clipboard not available in this browser", "error"); }
});

const SLOT_HOURS = { morning: [9, 12], afternoon: [13, 17], evening: [18, 20], night: [21, 23] };
function icsEscape(s) { return String(s || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, m => "\\" + m); }
function icsDate(d, h) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(h)}0000`;
}
els.icsBtn.addEventListener("click", () => {
  const it = state.itinerary;
  let start = parseISODate(it._meta?.start_date);
  if (!start) {
    toast("No start date set — calendar uses tomorrow as Day 1");
    start = addDays(new Date(new Date().toDateString()), 1);
  }
  const ev = [];
  it.days.forEach(day => {
    const date = addDays(start, day.day - 1);
    const used = {};
    day.activities.forEach(a => {
      const slot = SLOT_HOURS[(a.time || "").toLowerCase()] || [10, 12];
      const offset = used[a.time] = (used[a.time] ?? -1) + 1;
      const h1 = Math.min(23, slot[0] + offset), h2 = Math.min(23, Math.max(h1 + 1, slot[1] - 0));
      ev.push([
        "BEGIN:VEVENT",
        `UID:${state.tripId}-${day.day}-${ev.length}@tripcraft`,
        `DTSTAMP:${icsDate(new Date(), 0)}`,
        `DTSTART:${icsDate(date, h1)}`,
        `DTEND:${icsDate(date, offset ? h1 + 1 : h2)}`,
        `SUMMARY:${icsEscape(a.activity)}`,
        `LOCATION:${icsEscape(`${a.activity}, ${it.destination}`)}`,
        `DESCRIPTION:${icsEscape([a.description, a.location, a.cost_estimate && "Cost: " + a.cost_estimate].filter(Boolean).join("\n"))}`,
        "END:VEVENT",
      ].join("\r\n"));
    });
  });
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//TripCraft AI//EN", "CALSCALE:GREGORIAN", ...ev, "END:VCALENDAR"].join("\r\n");
  const blob = new Blob([ics], { type: "text/calendar" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${(it.destination || "trip").replace(/[^a-z0-9]+/gi, "_")}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// jsPDF's built-in fonts are Latin-1 only; strip characters it can't draw
const pdfSafe = (s) => String(s || "").replace(/[–—]/g, "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
  .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "");

els.downloadPdfBtn.addEventListener("click", () => {
  const it = state.itinerary;
  if (!it) return;
  if (!window.jspdf) { toast("PDF library failed to load — check your connection", "error"); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const marginX = 48;
  let y = 56;
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = doc.internal.pageSize.getWidth() - marginX * 2;

  function ensureSpace(h) { if (y + h > pageHeight - 48) { doc.addPage(); y = 56; } }
  function writeText(text, { size = 11, style = "normal", color = [30, 30, 30], gap = 16 } = {}) {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    doc.splitTextToSize(pdfSafe(text), maxWidth).forEach(line => {
      ensureSpace(gap); doc.text(line, marginX, y); y += gap;
    });
  }

  writeText(`${it.destination} - ${it.duration_days} Day Itinerary`, { size: 20, style: "bold", gap: 26 });
  const start = parseISODate(it._meta?.start_date);
  const metaLine = [start && `${fmtDate(start)} - ${fmtDate(addDays(start, it.duration_days - 1))}`,
    `Budget: ${it.budget}`, `Traveler: ${it.traveler_type}`, `Pace: ${it.pace}`].filter(Boolean).join("   |   ");
  writeText(metaLine, { size: 10, color: [100, 100, 100] });
  y += 6;
  if (it.summary) writeText(it.summary, { size: 11, color: [60, 60, 60], gap: 15 });
  if (it.estimated_total_cost) writeText(`Estimated total cost (per person): ${it.estimated_total_cost}`, { size: 10.5, style: "bold", color: [60, 60, 60], gap: 15 });
  y += 10;

  it.days.forEach(day => {
    y += 6;
    ensureSpace(24);
    const dd = dayDate(day.day);
    writeText(`Day ${day.day}${dd ? ` (${fmtDate(dd)})` : ""}: ${day.title || ""}` + (day.estimated_day_cost ? `  (~${day.estimated_day_cost})` : ""), { size: 14, style: "bold", gap: 20 });
    day.activities.forEach(act => {
      writeText(`${act.time || ""} - ${act.activity || ""}`, { size: 11.5, style: "bold", gap: 15 });
      if (act.description) writeText(act.description, { size: 10.5, color: [90, 90, 90], gap: 14 });
      const bits = [act.location && `Location: ${act.location}`, act.duration_estimate && `Duration: ${act.duration_estimate}`, act.cost_estimate && `Cost: ${act.cost_estimate}`].filter(Boolean);
      if (bits.length) writeText(bits.join("   |   "), { size: 9.5, color: [130, 130, 130], gap: 14 });
      y += 4;
    });
    if (day.meals.length) {
      writeText("Meals:", { size: 10.5, style: "bold", color: [70, 70, 70], gap: 14 });
      day.meals.forEach(m => {
        writeText(`${m.meal || "Meal"}: ${m.suggestion || ""}${m.cost_estimate ? ` (${m.cost_estimate})` : ""}`, { size: 10, color: [90, 90, 90], gap: 13 });
        if (m.description) writeText(m.description, { size: 9.5, color: [130, 130, 130], gap: 13 });
      });
    }
  });
  if (it.tips.length) {
    y += 10; ensureSpace(20);
    writeText("Good to know", { size: 14, style: "bold", gap: 20 });
    it.tips.forEach(tip => writeText(`- ${tip}`, { size: 10.5, color: [70, 70, 70], gap: 14 }));
  }
  doc.save(`${(it.destination || "itinerary").replace(/[^a-z0-9]+/gi, "_")}_itinerary.pdf`);
});

// ---------------------------------------------------------------------------
// Getting there, stays & deals
// ---------------------------------------------------------------------------
const MODE_ICON = { flight: "✈️", train: "🚆", bus: "🚌", car: "🚗", ferry: "⛴️", drive: "🚗", metro: "🚇",
  taxi: "🚕", cab: "🚕", auto: "🛺", scooter: "🛵", bike: "🚲", walk: "🚶", boat: "⛴️", tram: "🚋" };
function modeIcon(mode) {
  const m = String(mode || "").toLowerCase();
  const key = Object.keys(MODE_ICON).find(k => m.includes(k));
  return key ? MODE_ICON[key] : "🧭";
}
function dealLinks() {
  const it = state.itinerary, meta = it._meta || {};
  const dest = it.destination || "";
  const origin = meta.origin || "";
  const start = parseISODate(meta.start_date);
  const iso = (d) => d && `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const checkin = iso(start), checkout = start && iso(addDays(start, it.duration_days));
  const adults = meta.travelers || 1;
  const q = encodeURIComponent;
  const links = [];
  if (origin) {
    links.push(["✈️", "Flights", "Google Flights", `https://www.google.com/travel/flights?q=${q(`Flights from ${origin} to ${dest}${checkin ? " on " + checkin : ""}${checkout ? " returning " + checkout : ""}`)}`]);
    links.push(["🚆", "Trains", "Search trains", `https://www.google.com/search?q=${q(`trains from ${origin} to ${dest}`)}`]);
    links.push(["🚌", "Buses", "Search buses", `https://www.google.com/search?q=${q(`bus tickets ${origin} to ${dest}`)}`]);
  }
  const bk = new URLSearchParams({ ss: dest, group_adults: adults, no_rooms: Math.ceil(adults / 2) });
  if (checkin) { bk.set("checkin", checkin); bk.set("checkout", checkout); }
  links.push(["🏨", "Hotels", "Booking.com", `https://www.booking.com/searchresults.html?${bk}`]);
  const ab = new URLSearchParams({ adults });
  if (checkin) { ab.set("checkin", checkin); ab.set("checkout", checkout); }
  links.push(["🏡", "Homes", "Airbnb", `https://www.airbnb.com/s/${q(dest)}/homes?${ab}`]);
  links.push(["🎟️", "Tours & passes", "GetYourGuide", `https://www.getyourguide.com/s/?q=${q(dest)}`]);
  return links;
}
function renderLogistics() {
  const it = state.itinerary;
  const meta = it._meta || {};
  const parts = [];
  if (it.getting_there?.length) {
    parts.push(`
      <div class="logi-card">
        <h3>Getting there${meta.origin ? ` from ${escapeHtml(meta.origin)}` : ""}</h3>
        <div class="transport-grid">
          ${it.getting_there.map(g => `
            <div class="transport-opt">
              <div class="t-mode"><span class="t-icon">${modeIcon(g.mode)}</span>${escapeHtml(g.mode)}</div>
              ${g.route ? `<div class="t-route">${escapeHtml(g.route)}</div>` : ""}
              <div class="t-stats">
                <div><small>Time</small><strong>${escapeHtml(g.duration || "—")}</strong></div>
                <div><small>Fare / person</small><strong>${escapeHtml(g.fare_estimate || "—")}</strong></div>
              </div>
              ${g.notes ? `<p>${escapeHtml(g.notes)}</p>` : ""}
            </div>`).join("")}
        </div>
      </div>`);
  }
  if (it.local_transport?.length) {
    parts.push(`
      <div class="logi-card">
        <h3>Getting around</h3>
        <div class="local-list">
          ${it.local_transport.map(l => `
            <div class="local-row">
              <span class="t-icon">${modeIcon(l.mode)}</span>
              <div><strong>${escapeHtml(l.mode)}</strong>${l.notes ? `<span>${escapeHtml(l.notes)}</span>` : ""}</div>
              <em>${escapeHtml(l.typical_fare || "")}</em>
            </div>`).join("")}
        </div>
      </div>`);
  }
  if (it.stay_suggestions?.length) {
    parts.push(`
      <div class="logi-card">
        <h3>Where to stay</h3>
        <div class="stay-grid">
          ${it.stay_suggestions.map(st => `
            <a class="stay-card" target="_blank" rel="noopener" href="${mapsSearchUrl(`${st.name}, ${st.area || ""}, ${it.destination}`)}">
              <div class="stay-thumb">${{ hostel: "🛏️", hotel: "🏨", homestay: "🏡", resort: "🌴", apartment: "🔑" }[String(st.type || "").toLowerCase().split(/[ /]/)[0]] || "🏨"}</div>
              <div class="stay-body">
                <div class="stay-top"><strong>${escapeHtml(st.name)}</strong><span>${escapeHtml(st.type || "")}</span></div>
                ${st.area ? `<div class="stay-area">${escapeHtml(st.area)}</div>` : ""}
                ${st.why ? `<p>${escapeHtml(st.why)}</p>` : ""}
                ${st.price_per_night ? `<div class="stay-price"><strong>${escapeHtml(st.price_per_night)}</strong> night</div>` : ""}
              </div>
            </a>`).join("")}
        </div>
      </div>`);
  }
  parts.push(`
    <div class="logi-card deals-card">
      <h3>💸 Deals &amp; ways to save</h3>
      ${it.deals?.length ? `<div class="deal-list">
        ${it.deals.map(dl => `
          <div class="deal">
            <div><strong>${escapeHtml(dl.title)}</strong><p>${escapeHtml(dl.description || "")}</p></div>
            ${dl.estimated_saving ? `<span class="saving">Save ${escapeHtml(String(dl.estimated_saving).replace(/^save\s*/i, ""))}</span>` : ""}
          </div>`).join("")}
      </div>` : ""}
      <p class="step-sub deal-sub">Check live prices for your dates:</p>
      <div class="deal-links">
        ${dealLinks().map(([icon, label, site, url]) => `
          <a class="deal-link" href="${url}" target="_blank" rel="noopener"><span>${icon}</span><div><strong>${label}</strong><small>${site} ↗</small></div></a>`).join("")}
      </div>
      <p class="fine-print">Fares and savings are AI estimates, not live quotes. Confirm on the booking site.</p>
    </div>`);
  els.logistics.innerHTML = parts.join("");
}

// ---------------------------------------------------------------------------
// Destination ideas (by interests + month)
// ---------------------------------------------------------------------------
const ALL_INTERESTS = [...document.querySelectorAll('[data-field="interests"] .option-card')].map(c => c.dataset.value);
const ideas = {
  toggle: $("ideasToggle"), panel: $("ideasPanel"), month: $("ideasMonth"), region: $("ideasRegion"),
  origin: $("ideasOrigin"), interests: $("ideasInterests"), btn: $("ideasBtn"), error: $("ideasError"), results: $("ideasResults"),
};
(function initIdeas() {
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const opt = document.createElement("option");
    opt.value = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    opt.textContent = opt.value;
    ideas.month.appendChild(opt);
  }
})();
function renderIdeaInterests() {
  ideas.interests.innerHTML = ALL_INTERESTS.map(v =>
    `<button type="button" class="chip ${state.data.interests.includes(v) ? "on" : ""}" data-interest="${escapeHtml(v)}">${escapeHtml(v)}</button>`).join("");
}
ideas.interests.addEventListener("click", e => {
  const c = e.target.closest("[data-interest]");
  if (!c) return;
  const v = c.dataset.interest, set = new Set(state.data.interests);
  set.has(v) ? set.delete(v) : set.add(v);
  state.data.interests = [...set];
  syncOptionCards(); renderIdeaInterests(); storage.set(DRAFT_KEY, state.data);
});
ideas.toggle.addEventListener("click", () => {
  ideas.panel.hidden = !ideas.panel.hidden;
  ideas.toggle.classList.toggle("open", !ideas.panel.hidden);
  if (!ideas.origin.value) ideas.origin.value = els.origin.value;
  renderIdeaInterests();
});
ideas.btn.addEventListener("click", async () => {
  if (state.busy) return;
  ideas.error.style.display = "none";
  ideas.btn.disabled = true;
  ideas.btn.textContent = "Finding ideas…";
  ideas.results.innerHTML = Array(6).fill('<div class="idea-card skeleton"></div>').join("");
  try {
    const res = await fetch("/api/suggest-destinations", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interests: state.data.interests, month: ideas.month.value, region: ideas.region.value,
        origin: ideas.origin.value.trim(), budget: state.data.budget }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not get suggestions.");
    ideas.results.innerHTML = data.suggestions.map((sg, i) => `
      <button type="button" class="idea-card" data-idx="${i}">
        <div class="idea-top"><strong>${escapeHtml(sg.destination)}</strong>${sg.ideal_days ? `<span>${escapeHtml(sg.ideal_days)} days</span>` : ""}</div>
        ${sg.tagline ? `<div class="idea-tag">${escapeHtml(sg.tagline)}</div>` : ""}
        <p>${escapeHtml(sg.why || "")}</p>
        <div class="idea-meta">
          ${sg.weather ? `<span>🌤 ${escapeHtml(sg.weather)}</span>` : ""}
          ${sg.est_cost_per_day ? `<span>💰 ${escapeHtml(sg.est_cost_per_day)}/day</span>` : ""}
          ${sg.travel_from_origin ? `<span>🧭 ${escapeHtml(sg.travel_from_origin)}</span>` : ""}
        </div>
        <span class="idea-pick">Plan this trip →</span>
      </button>`).join("");
    ideas.results._data = data.suggestions;
  } catch (e) {
    ideas.results.innerHTML = "";
    ideas.error.textContent = e.message;
    ideas.error.style.display = "block";
  } finally {
    ideas.btn.disabled = false;
    ideas.btn.textContent = "Find destinations";
  }
});
ideas.results.addEventListener("click", e => {
  const card = e.target.closest(".idea-card[data-idx]");
  if (!card) return;
  const sg = ideas.results._data[card.dataset.idx];
  els.destination.value = sg.destination;
  state.data.dest_coords = null;
  const n = parseInt(sg.ideal_days, 10);
  if (n >= 1 && n <= 30) els.duration.value = n;
  if (ideas.origin.value.trim() && !els.origin.value) els.origin.value = ideas.origin.value.trim();
  readInputs(); updateEndDateHint();
  toast(`${sg.destination} selected`, "success");
  goNext();
});

// Warn before leaving mid-generation
window.addEventListener("beforeunload", (e) => { if (state.busy) { e.preventDefault(); e.returnValue = ""; } });

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
attachAutocomplete(els.destination, {
  onSelect: (p) => { state.data.dest_coords = p.lat != null ? { lat: p.lat, lon: p.lon, cc: p.countrycode } : null; },
});
els.destination.addEventListener("input", () => { if (!els.destination.dataset.picked) state.data.dest_coords = null; });
attachAutocomplete(els.origin, { onSelect: (p) => { state.data.origin_cc = p.countrycode || null; } });
attachAutocomplete(document.getElementById("ideasOrigin"));

checkOllamaStatus();
restoreWizard(storage.get(DRAFT_KEY, emptyData()));
refreshTripsButton();
renderIdeaInterests();
showStep(1);
