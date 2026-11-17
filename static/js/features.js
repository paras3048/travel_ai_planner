// ===========================================================================
// TripCraft AI — trip toolkit: tabs, weather, budget & expense split,
// currency converter, packing list, travel essentials, AI chat, share links.
// Relies on globals from app.js (state, els, escapeHtml, toast, saveTrip, …).
// ===========================================================================

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
const tabs = {
  bar: document.getElementById("tabs"),
  current: "plan",
  lastTripId: null,
};
const RENDERERS = {
  plan: () => {},
  travel: () => {},              // rendered by app.js (renderLogistics)
  weather: renderWeather,
  budget: renderBudget,
  packing: renderPacking,
  essentials: renderEssentials,
  chat: renderChat,
};
function switchTab(name, { scroll = true } = {}) {
  tabs.current = name;
  tabs.bar.querySelectorAll(".tab").forEach(t => {
    const on = t.dataset.tab === name;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on);
  });
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.dataset.panel === name));
  RENDERERS[name]?.();
  if (scroll) {
    const top = tabs.bar.getBoundingClientRect().top + window.scrollY - 70;
    if (window.scrollY > top) window.scrollTo({ top, behavior: "smooth" });
  }
  tabs.bar.querySelector(".tab.active")?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
}
tabs.bar.addEventListener("click", e => {
  const t = e.target.closest(".tab");
  if (t) switchTab(t.dataset.tab);
});
window.onResultsRendered = () => {
  if (state.tripId !== tabs.lastTripId) {
    tabs.lastTripId = state.tripId;
    weatherCache.key = null;
    switchTab("plan", { scroll: false });
  } else if (tabs.current !== "plan") {
    RENDERERS[tabs.current]?.();
  }
};
function persistExtras() { saveTrip(); }
function panelLoading(el, text) {
  el.innerHTML = `<div class="panel-loading"><div class="spinner"></div><p>${escapeHtml(text)}</p></div>`;
}
function panelError(el, msg, retryLabel, retryFn) {
  el.innerHTML = `<div class="error-banner">${escapeHtml(msg)}</div>
    <button type="button" class="btn btn-secondary btn-sm retry-btn">${escapeHtml(retryLabel)}</button>`;
  el.querySelector(".retry-btn").onclick = retryFn;
}
async function postJSON(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data.error || `Request failed (HTTP ${res.status}).`);
  return data;
}
const tripDates = () => {
  const it = state.itinerary;
  const start = parseISODate(it._meta?.start_date);
  return { start, end: start ? addDays(start, it.duration_days - 1) : null, n: it.duration_days };
};
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ---------------------------------------------------------------------------
// Location helpers (coords + currency)
// ---------------------------------------------------------------------------
const COUNTRY_CURRENCY = {
  in: "INR", us: "USD", gb: "GBP", ae: "AED", th: "THB", sg: "SGD", jp: "JPY", id: "IDR", my: "MYR", vn: "VND",
  lk: "LKR", np: "NPR", au: "AUD", ca: "CAD", ch: "CHF", cn: "CNY", hk: "HKD", kr: "KRW", tr: "TRY", ge: "GEL",
  qa: "QAR", om: "OMR", eg: "EGP", ma: "MAD", za: "ZAR", ke: "KES", nz: "NZD", mx: "MXN", br: "BRL", ar: "ARS",
  mv: "MVR", bt: "BTN", se: "SEK", no: "NOK", dk: "DKK", cz: "CZK", hu: "HUF", pl: "PLN", is: "ISK", ph: "PHP",
  kh: "KHR", la: "LAK", tw: "TWD", jo: "JOD", az: "AZN", kz: "KZT", pe: "PEN", tz: "TZS", mu: "MUR", sc: "SCR",
  fj: "FJD", sa: "SAR", bd: "BDT", pk: "PKR", ru: "RUB",
  fr: "EUR", de: "EUR", it: "EUR", es: "EUR", pt: "EUR", nl: "EUR", be: "EUR", at: "EUR", gr: "EUR", ie: "EUR",
  fi: "EUR", hr: "EUR", si: "EUR", sk: "EUR", ee: "EUR", lv: "EUR", lt: "EUR", lu: "EUR", mt: "EUR", cy: "EUR",
};
const COUNTRY_NAMES = {
  india: "in", usa: "us", "united states": "us", uk: "gb", "united kingdom": "gb", england: "gb", scotland: "gb",
  uae: "ae", "united arab emirates": "ae", thailand: "th", singapore: "sg", japan: "jp", indonesia: "id",
  malaysia: "my", vietnam: "vn", "sri lanka": "lk", nepal: "np", australia: "au", canada: "ca", switzerland: "ch",
  china: "cn", "hong kong": "hk", "south korea": "kr", korea: "kr", türkiye: "tr", turkey: "tr", georgia: "ge",
  qatar: "qa", oman: "om", egypt: "eg", morocco: "ma", "south africa": "za", kenya: "ke", "new zealand": "nz",
  mexico: "mx", brazil: "br", argentina: "ar", maldives: "mv", bhutan: "bt", sweden: "se", norway: "no",
  denmark: "dk", czechia: "cz", "czech republic": "cz", hungary: "hu", poland: "pl", iceland: "is",
  philippines: "ph", cambodia: "kh", laos: "la", taiwan: "tw", jordan: "jo", azerbaijan: "az", kazakhstan: "kz",
  peru: "pe", tanzania: "tz", mauritius: "mu", seychelles: "sc", fiji: "fj", "saudi arabia": "sa",
  france: "fr", germany: "de", italy: "it", spain: "es", portugal: "pt", netherlands: "nl", belgium: "be",
  austria: "at", greece: "gr", ireland: "ie", finland: "fi", croatia: "hr", slovenia: "si",
};
function countryCodeFromText(text) {
  const parts = String(text || "").toLowerCase().split(",").map(s => s.trim()).reverse();
  for (const p of parts) if (COUNTRY_NAMES[p]) return COUNTRY_NAMES[p];
  const whole = String(text || "").toLowerCase();
  return Object.keys(COUNTRY_NAMES).find(k => whole.includes(k)) ? COUNTRY_NAMES[Object.keys(COUNTRY_NAMES).find(k => whole.includes(k))] : null;
}
function destCurrency() {
  const it = state.itinerary;
  const ess = state.extras.essentials?.currency?.code;
  if (ess && /^[A-Z]{3}$/.test(ess)) return ess;
  const cc = (it._meta?.coords?.cc || countryCodeFromText(it.destination) || "").toLowerCase();
  return COUNTRY_CURRENCY[cc] || "USD";
}
const INDIAN_CITIES = /delhi|mumbai|bombay|bengaluru|bangalore|chennai|kolkata|hyderabad|pune|ahmedabad|jaipur|lucknow|chandigarh|noida|gurgaon|gurugram|kochi|indore|bhopal|nagpur|surat|patna|bhubaneswar|guwahati|dehradun|coimbatore|vizag|visakhapatnam|kanpur|varanasi|amritsar|goa/i;
function homeCurrency() {
  const origin = state.itinerary._meta?.origin || "";
  const cc = state.itinerary._meta?.origin_cc?.toLowerCase() || countryCodeFromText(origin) || (INDIAN_CITIES.test(origin) ? "in" : null);
  if (cc && COUNTRY_CURRENCY[cc]) return COUNTRY_CURRENCY[cc];
  try {
    const region = new Intl.Locale(navigator.language).maximize().region?.toLowerCase();
    if (region && COUNTRY_CURRENCY[region]) return COUNTRY_CURRENCY[region];
  } catch {}
  return "INR";
}
async function getCoords() {
  const it = state.itinerary;
  if (it._meta?.coords?.lat != null) return it._meta.coords;
  if (state.extras.coords) return state.extras.coords;
  const parts = it.destination.split(",").map(s => s.trim());
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(parts[0])}&count=10&language=en`);
  const data = await res.json();
  const results = data.results || [];
  if (!results.length) throw new Error(`Couldn't find “${parts[0]}” on the map.`);
  const hint = parts.slice(1).join(" ").toLowerCase();
  const best = results.find(r => hint && (hint.includes((r.country || "").toLowerCase()) || hint.includes((r.admin1 || "").toLowerCase()))) || results[0];
  state.extras.coords = { lat: best.latitude, lon: best.longitude, cc: best.country_code };
  persistExtras();
  return state.extras.coords;
}

// ---------------------------------------------------------------------------
// Weather (Open-Meteo — free, no key)
// ---------------------------------------------------------------------------
const WMO = {
  0: ["☀️", "Clear"], 1: ["🌤", "Mostly clear"], 2: ["⛅", "Partly cloudy"], 3: ["☁️", "Overcast"],
  45: ["🌫", "Fog"], 48: ["🌫", "Fog"], 51: ["🌦", "Light drizzle"], 53: ["🌦", "Drizzle"], 55: ["🌧", "Heavy drizzle"],
  56: ["🌧", "Freezing drizzle"], 57: ["🌧", "Freezing drizzle"], 61: ["🌦", "Light rain"], 63: ["🌧", "Rain"],
  65: ["🌧", "Heavy rain"], 66: ["🌧", "Freezing rain"], 67: ["🌧", "Freezing rain"], 71: ["🌨", "Light snow"],
  73: ["🌨", "Snow"], 75: ["❄️", "Heavy snow"], 77: ["🌨", "Snow grains"], 80: ["🌦", "Showers"], 81: ["🌧", "Showers"],
  82: ["⛈", "Violent showers"], 85: ["🌨", "Snow showers"], 86: ["❄️", "Snow showers"], 95: ["⛈", "Thunderstorm"],
  96: ["⛈", "Thunderstorm + hail"], 99: ["⛈", "Thunderstorm + hail"],
};
const weatherCache = { key: null, data: null };

async function fetchWeather() {
  const coords = await getCoords();
  const { start, n } = tripDates();
  const today = new Date(new Date().toDateString());
  const first = start || today;
  const last = addDays(first, n - 1);
  const horizon = addDays(today, 15);
  let url, mode;
  const daily = "weather_code,temperature_2m_max,temperature_2m_min";
  if (first <= horizon && last >= today) {
    const from = first < today ? today : first;
    const to = last > horizon ? horizon : last;
    url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&daily=${daily},precipitation_probability_max,precipitation_sum,uv_index_max&timezone=auto&start_date=${isoDay(from)}&end_date=${isoDay(to)}`;
    mode = "forecast";
  } else {
    const ly = (d) => { const x = new Date(d); x.setFullYear(x.getFullYear() - 1); return x; };
    url = `https://archive-api.open-meteo.com/v1/archive?latitude=${coords.lat}&longitude=${coords.lon}&daily=${daily},precipitation_sum&timezone=auto&start_date=${isoDay(ly(first))}&end_date=${isoDay(ly(last))}`;
    mode = "history";
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error("Weather service unavailable right now.");
  const data = await res.json();
  const d = data.daily || {};
  const days = (d.time || []).map((t, i) => ({
    date: parseISODate(t),
    code: d.weather_code?.[i], max: d.temperature_2m_max?.[i], min: d.temperature_2m_min?.[i],
    pop: d.precipitation_probability_max?.[i], rain: d.precipitation_sum?.[i], uv: d.uv_index_max?.[i],
  }));
  if (mode === "history") days.forEach(x => x.date.setFullYear(x.date.getFullYear() + 1));
  return { mode, days, hasDates: !!start };
}

function weatherSummary(w) {
  if (!w?.days?.length) return "";
  const hi = Math.round(Math.max(...w.days.map(d => d.max ?? -99)));
  const lo = Math.round(Math.min(...w.days.map(d => d.min ?? 99)));
  const wet = w.days.filter(d => (d.pop ?? 0) >= 50 || (d.rain ?? 0) >= 2).length;
  return `${lo}–${hi}°C, ${wet} of ${w.days.length} days with rain likely`;
}

async function renderWeather() {
  const el = document.getElementById("weatherPanel");
  const key = `${state.tripId}|${state.itinerary._meta?.start_date}|${state.itinerary.duration_days}`;
  if (weatherCache.key === key && weatherCache.data) return drawWeather(el, weatherCache.data);
  panelLoading(el, "Checking the weather…");
  try {
    const w = await fetchWeather();
    weatherCache.key = key; weatherCache.data = w;
    state.extras.weatherSummary = weatherSummary(w);
    persistExtras();
    if (tabs.current === "weather") drawWeather(el, w);
  } catch (e) {
    panelError(el, e.message || "Couldn't load weather.", "Try again", renderWeather);
  }
}
function drawWeather(el, w) {
  const it = state.itinerary;
  if (!w.days.length) { el.innerHTML = `<div class="card">No weather data available for these dates.</div>`; return; }
  const note = w.mode === "forecast"
    ? (w.hasDates ? "Live forecast for your dates" : "Next few days (add a start date to see your trip dates)")
    : "Your dates are beyond the 16-day forecast, so this shows the actual weather on the same dates last year as a guide.";
  const wet = w.days.filter(d => (d.pop ?? 0) >= 50 || (d.rain ?? 0) >= 2).length;
  const hi = Math.max(...w.days.map(d => d.max ?? -99)), lo = Math.min(...w.days.map(d => d.min ?? 99));
  const advice = [];
  if (wet) advice.push(`☔ Rain likely on ${wet} day${wet > 1 ? "s" : ""}: pack a compact umbrella and plan indoor backups.`);
  if (hi >= 32) advice.push("🥵 Hot afternoons: schedule outdoor sights early morning or evening, carry water and sunscreen.");
  if (lo <= 8) advice.push("🧥 Cold mornings/nights: bring warm layers.");
  if (w.days.some(d => (d.uv ?? 0) >= 8)) advice.push("🕶 Very high UV: sunglasses, hat and SPF 50.");
  if (!advice.length) advice.push("👌 Comfortable conditions. Light layers should do.");
  el.innerHTML = `
    <div class="card weather-card">
      <div class="weather-head">
        <div>
          <h3>Weather in ${escapeHtml(it.destination)}</h3>
          <p class="step-sub">${escapeHtml(note)}</p>
        </div>
        <div class="weather-range"><strong>${Math.round(lo)}° – ${Math.round(hi)}°C</strong><span>${wet} rainy day${wet === 1 ? "" : "s"}</span></div>
      </div>
      <div class="weather-grid">
        ${w.days.map(d => {
          const [icon, label] = WMO[d.code] || ["🌡", "—"];
          return `<div class="wx-day">
            <div class="wx-date">${fmtDate(d.date, { weekday: "short", day: "numeric", month: "short" })}</div>
            <div class="wx-icon" title="${label}">${icon}</div>
            <div class="wx-label">${label}</div>
            <div class="wx-temp"><strong>${Math.round(d.max)}°</strong> <span>${Math.round(d.min)}°</span></div>
            <div class="wx-rain">💧 ${d.pop != null ? `${d.pop}%` : `${(d.rain ?? 0).toFixed(1)} mm`}</div>
          </div>`;
        }).join("")}
      </div>
      <ul class="advice">${advice.map(a => `<li>${escapeHtml(a)}</li>`).join("")}</ul>
      <p class="fine-print">Data: Open-Meteo.</p>
    </div>`;
}

// ---------------------------------------------------------------------------
// Budget, expense split & currency converter
// ---------------------------------------------------------------------------
const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "THB", "SGD", "JPY", "IDR", "MYR", "VND", "LKR", "NPR", "AUD",
  "CAD", "CHF", "CNY", "HKD", "KRW", "TRY", "GEL", "QAR", "OMR", "SAR", "EGP", "MAD", "ZAR", "KES", "TZS", "MUR", "SCR",
  "NZD", "MXN", "BRL", "ARS", "PEN", "MVR", "BTN", "SEK", "NOK", "DKK", "CZK", "HUF", "PLN", "ISK", "PHP", "KHR",
  "LAK", "TWD", "JOD", "AZN", "KZT", "FJD", "BDT", "PKR"];
const CATEGORIES = { food: "🍜 Food", stay: "🏨 Stay", transport: "🚕 Transport", activities: "🎟 Activities", shopping: "🛍 Shopping", other: "📦 Other" };
const rateCache = {};
async function getRates(base) {
  if (rateCache[base] && Date.now() - rateCache[base].t < 3600e3) return rateCache[base].rates;
  const res = await fetch(`https://open.er-api.com/v6/latest/${base}`);
  const data = await res.json();
  if (data.result !== "success") throw new Error("Exchange rates unavailable.");
  rateCache[base] = { t: Date.now(), rates: data.rates };
  return data.rates;
}
function money(n, cur) {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: cur, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n); }
  catch { return `${cur} ${n.toFixed(2)}`; }
}
function budgetState() {
  const n = state.itinerary._meta?.travelers || 1;
  if (!state.extras.budget) {
    state.extras.budget = {
      currency: homeCurrency(), limit: 0, expenses: [],
      people: Array.from({ length: n }, (_, i) => i === 0 ? "You" : `Traveler ${i + 1}`),
    };
  }
  return state.extras.budget;
}
function settleUp(b) {
  const net = b.people.map(() => 0);
  b.expenses.forEach(x => {
    const among = x.split?.length ? x.split : b.people.map((_, i) => i);
    net[x.paidBy] += x.amount;
    among.forEach(i => { net[i] -= x.amount / among.length; });
  });
  const debtors = [], creditors = [];
  net.forEach((v, i) => { if (v < -0.01) debtors.push([i, -v]); else if (v > 0.01) creditors.push([i, v]); });
  const moves = [];
  let di = 0, ci = 0;
  while (di < debtors.length && ci < creditors.length) {
    const amt = Math.min(debtors[di][1], creditors[ci][1]);
    moves.push({ from: debtors[di][0], to: creditors[ci][0], amount: amt });
    debtors[di][1] -= amt; creditors[ci][1] -= amt;
    if (debtors[di][1] < 0.01) di++;
    if (creditors[ci][1] < 0.01) ci++;
  }
  return { net, moves };
}

function renderBudget() {
  const el = document.getElementById("budgetPanel");
  const it = state.itinerary;
  const b = budgetState();
  const spent = b.expenses.reduce((s, x) => s + x.amount, 0);
  const pct = b.limit ? Math.min(100, (spent / b.limit) * 100) : 0;
  const byCat = {};
  b.expenses.forEach(x => byCat[x.cat] = (byCat[x.cat] || 0) + x.amount);
  const { net, moves } = settleUp(b);
  const cur = b.currency;
  const curOpts = (sel) => CURRENCIES.map(c => `<option ${c === sel ? "selected" : ""}>${c}</option>`).join("");

  el.innerHTML = `
    <div class="budget-grid">
      <div class="card">
        <h3>AI cost estimate</h3>
        <div class="est-totals">
          ${it.estimated_total_cost ? `<div><small>Per person</small><strong>${escapeHtml(it.estimated_total_cost)}</strong></div>` : ""}
          ${it.estimated_group_total && (it._meta?.travelers > 1) ? `<div><small>Whole group</small><strong>${escapeHtml(it.estimated_group_total)}</strong></div>` : ""}
        </div>
        <ul class="est-days">
          ${it.days.map(d => `<li><span>Day ${d.day} · ${escapeHtml(d.title || "")}</span><strong>${escapeHtml(d.estimated_day_cost || "—")}</strong></li>`).join("")}
        </ul>
        <p class="fine-print">Estimates from the AI; actual prices vary by season and availability.</p>
      </div>

      <div class="card">
        <h3>Track your spending</h3>
        <div class="row-2">
          <label class="field"><span class="field-label">Trip budget</span>
            <input type="number" id="bLimit" min="0" step="any" value="${b.limit || ""}" placeholder="e.g. 50000"></label>
          <label class="field"><span class="field-label">Currency</span>
            <select id="bCurrency">${curOpts(cur)}</select></label>
        </div>
        <div class="spend-meter ${b.limit && spent > b.limit ? "over" : ""}">
          <div class="spend-top"><strong>${money(spent, cur)}</strong> spent${b.limit ? ` of ${money(b.limit, cur)}` : ""}
            ${b.limit ? `<span>${spent > b.limit ? `${money(spent - b.limit, cur)} over` : `${money(b.limit - spent, cur)} left`}</span>` : ""}</div>
          ${b.limit ? `<div class="meter"><div style="width:${pct}%"></div></div>` : ""}
        </div>
        ${Object.keys(byCat).length ? `<ul class="cat-bars">${Object.entries(byCat).sort((a, z) => z[1] - a[1]).map(([c, v]) => `
          <li><span>${CATEGORIES[c] || c}</span><div class="meter thin"><div style="width:${(v / spent) * 100}%"></div></div><strong>${money(v, cur)}</strong></li>`).join("")}</ul>` : ""}
      </div>

      <div class="card span-2">
        <h3>Split expenses</h3>
        <p class="step-sub">Log who paid for what; we'll work out who owes whom.</p>
        <div class="people">
          ${b.people.map((p, i) => `<input class="person" data-person="${i}" value="${escapeHtml(p)}" maxlength="24" aria-label="Traveler ${i + 1} name">`).join("")}
          <button type="button" class="chip" id="addPerson">＋ Person</button>
        </div>
        <form id="expForm" class="exp-form">
          <input type="text" id="expDesc" placeholder="What was it? e.g. Dinner at Fisherman's Wharf" maxlength="80" required>
          <input type="number" id="expAmt" placeholder="Amount (${cur})" min="0" step="any" required>
          <select id="expPaid" aria-label="Paid by">${b.people.map((p, i) => `<option value="${i}">${escapeHtml(p)} paid</option>`).join("")}</select>
          <select id="expCat" aria-label="Category">${Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
          <button type="submit" class="btn btn-primary btn-sm">Add</button>
        </form>
        ${b.people.length > 1 ? `<div class="split-among"><span>Split between:</span>
          ${b.people.map((p, i) => `<label><input type="checkbox" class="split-cb" value="${i}" checked> ${escapeHtml(p)}</label>`).join("")}</div>` : ""}
        ${b.expenses.length ? `
          <ul class="exp-list">
            ${b.expenses.slice().reverse().map(x => `
              <li>
                <span class="exp-cat">${(CATEGORIES[x.cat] || "📦").split(" ")[0]}</span>
                <div><strong>${escapeHtml(x.desc)}</strong><small>${escapeHtml(b.people[x.paidBy] || "?")} paid · ${x.split?.length && x.split.length < b.people.length ? `split ${x.split.map(i => escapeHtml(b.people[i])).join(", ")}` : "split equally"}</small></div>
                <strong>${money(x.amount, cur)}</strong>
                <button type="button" class="icon-btn" data-del-exp="${x.id}" aria-label="Delete expense">✕</button>
              </li>`).join("")}
          </ul>
          ${b.people.length > 1 ? `
          <div class="settle">
            <h4>Balances</h4>
            <div class="balances">${net.map((v, i) => `<span class="${v > 0.01 ? "pos" : v < -0.01 ? "neg" : ""}">${escapeHtml(b.people[i])}: ${v > 0.01 ? "gets back " : v < -0.01 ? "owes " : "settled "}${Math.abs(v) > 0.01 ? money(Math.abs(v), cur) : ""}</span>`).join("")}</div>
            <h4>Settle up</h4>
            ${moves.length ? `<ul class="moves">${moves.map(m => `<li>${escapeHtml(b.people[m.from])} → ${escapeHtml(b.people[m.to])}: <strong>${money(m.amount, cur)}</strong></li>`).join("")}</ul>` : `<p class="step-sub">Everyone is square 🎉</p>`}
          </div>` : ""}` : `<p class="empty">No expenses yet.</p>`}
      </div>

      <div class="card span-2">
        <h3>Currency converter</h3>
        <div class="fx">
          <input type="number" id="fxAmt" value="1000" min="0" step="any" aria-label="Amount">
          <select id="fxFrom" aria-label="From">${curOpts(homeCurrency())}</select>
          <button type="button" class="icon-btn fx-swap" id="fxSwap" aria-label="Swap currencies">⇄</button>
          <select id="fxTo" aria-label="To">${curOpts(destCurrency() === homeCurrency() ? (homeCurrency() === "USD" ? "EUR" : "USD") : destCurrency())}</select>
        </div>
        <div id="fxOut" class="fx-out">…</div>
        <p class="fine-print">Mid-market rates from open.er-api.com, updated daily. Banks and exchange counters add a margin.</p>
      </div>
    </div>`;

  const $b = (id) => document.getElementById(id);
  $b("bLimit").onchange = (e) => { b.limit = parseFloat(e.target.value) || 0; persistExtras(); renderBudget(); };
  $b("bCurrency").onchange = (e) => { b.currency = e.target.value; persistExtras(); renderBudget(); };
  el.querySelectorAll(".person").forEach(inp => inp.onchange = () => {
    b.people[inp.dataset.person] = inp.value.trim() || `Traveler ${+inp.dataset.person + 1}`;
    persistExtras(); renderBudget();
  });
  $b("addPerson").onclick = () => { b.people.push(`Traveler ${b.people.length + 1}`); persistExtras(); renderBudget(); };
  $b("expForm").onsubmit = (e) => {
    e.preventDefault();
    const amount = parseFloat($b("expAmt").value);
    if (!(amount > 0)) return;
    const split = [...el.querySelectorAll(".split-cb:checked")].map(c => +c.value);
    b.expenses.push({ id: `e${Date.now()}`, desc: $b("expDesc").value.trim(), amount, paidBy: +$b("expPaid").value,
      cat: $b("expCat").value, split: split.length ? split : b.people.map((_, i) => i), at: Date.now() });
    persistExtras(); renderBudget();
    toast("Expense added ✓", "success");
    document.getElementById("expDesc")?.focus();
  };
  el.querySelectorAll("[data-del-exp]").forEach(btn => btn.onclick = () => {
    b.expenses = b.expenses.filter(x => x.id !== btn.dataset.delExp);
    persistExtras(); renderBudget();
  });
  const convert = async () => {
    const out = $b("fxOut"); if (!out) return;
    const amt = parseFloat($b("fxAmt").value) || 0, from = $b("fxFrom").value, to = $b("fxTo").value;
    try {
      const rates = await getRates(from);
      if (!rates[to]) throw new Error(`No rate for ${to}`);
      out.innerHTML = `${money(amt, from)} = <strong>${money(amt * rates[to], to)}</strong><small>1 ${from} = ${rates[to].toFixed(4)} ${to}</small>`;
    } catch (e) { out.textContent = e.message || "Rates unavailable offline."; }
  };
  ["fxAmt", "fxFrom", "fxTo"].forEach(id => $b(id).addEventListener("input", convert));
  $b("fxSwap").onclick = () => { const f = $b("fxFrom").value; $b("fxFrom").value = $b("fxTo").value; $b("fxTo").value = f; convert(); };
  convert();
}

// ---------------------------------------------------------------------------
// Packing list
// ---------------------------------------------------------------------------
async function generatePacking() {
  const el = document.getElementById("packingPanel");
  panelLoading(el, "Building a packing list for your trip, dates and activities…");
  try {
    if (!state.extras.weatherSummary) {
      try { state.extras.weatherSummary = weatherSummary(await fetchWeather()); } catch {}
    }
    const data = await postJSON("/api/packing-list", { itinerary: state.itinerary, weather: state.extras.weatherSummary || "" });
    const old = state.extras.packing || {};
    state.extras.packing = { categories: data.categories, checked: old.checked || {}, custom: old.custom || [] };
    persistExtras();
    if (tabs.current === "packing") renderPacking();
  } catch (e) {
    panelError(el, e.message, "Try again", generatePacking);
  }
}
function renderPacking() {
  const el = document.getElementById("packingPanel");
  const pk = state.extras.packing;
  if (!pk) {
    el.innerHTML = `<div class="card empty-state">
      <div class="empty-icon">🎒</div>
      <h3>Smart packing list</h3>
      <p class="step-sub">Built around your destination, weather, activities and trip length.</p>
      <button type="button" class="btn btn-primary" id="genPack">Generate packing list</button></div>`;
    document.getElementById("genPack").onclick = generatePacking;
    return;
  }
  const cats = [...pk.categories];
  if (pk.custom.length) cats.push({ name: "My items", items: pk.custom.map(item => ({ item, custom: true })) });
  const keyOf = (c, i) => `${c}|${i.item}`;
  const total = cats.reduce((s, c) => s + c.items.length, 0);
  const done = cats.reduce((s, c) => s + c.items.filter(i => pk.checked[keyOf(c.name, i)]).length, 0);
  el.innerHTML = `
    <div class="card">
      <div class="pack-head">
        <div><h3>Packing list</h3><p class="step-sub">${done} of ${total} packed</p></div>
        <div class="pack-actions">
          <button type="button" class="btn btn-ghost btn-sm" id="packReset">Uncheck all</button>
          <button type="button" class="btn btn-ghost btn-sm" id="packRegen">↻ Regenerate</button>
        </div>
      </div>
      <div class="meter"><div style="width:${total ? (done / total) * 100 : 0}%"></div></div>
      <form id="packAddForm" class="pack-add">
        <input type="text" id="packAdd" placeholder="Add your own item…" maxlength="60">
        <button class="btn btn-secondary btn-sm" type="submit">Add</button>
      </form>
      <div class="pack-grid">
        ${cats.map(c => `
          <div class="pack-cat">
            <h4>${escapeHtml(c.name)} <small>${c.items.filter(i => pk.checked[keyOf(c.name, i)]).length}/${c.items.length}</small></h4>
            ${c.items.map(i => {
              const k = keyOf(c.name, i);
              return `<label class="pack-item ${pk.checked[k] ? "checked" : ""}">
                <input type="checkbox" data-key="${escapeHtml(k)}" ${pk.checked[k] ? "checked" : ""}>
                <span>${escapeHtml(i.item)}${i.qty ? ` <em>× ${escapeHtml(i.qty)}</em>` : ""}${i.why ? `<small>${escapeHtml(i.why)}</small>` : ""}</span>
                ${i.custom ? `<button type="button" class="icon-btn" data-del-item="${escapeHtml(i.item)}" aria-label="Remove">✕</button>` : ""}
              </label>`;
            }).join("")}
          </div>`).join("")}
      </div>
    </div>`;
  el.querySelectorAll("input[data-key]").forEach(cb => cb.onchange = () => {
    if (cb.checked) pk.checked[cb.dataset.key] = true; else delete pk.checked[cb.dataset.key];
    persistExtras();
    const y = window.scrollY; renderPacking(); window.scrollTo(0, y);
  });
  el.querySelectorAll("[data-del-item]").forEach(b => b.onclick = (e) => {
    e.preventDefault();
    pk.custom = pk.custom.filter(x => x !== b.dataset.delItem); persistExtras(); renderPacking();
  });
  document.getElementById("packAddForm").onsubmit = (e) => {
    e.preventDefault();
    const v = document.getElementById("packAdd").value.trim();
    if (v && !pk.custom.includes(v)) { pk.custom.push(v); persistExtras(); renderPacking(); document.getElementById("packAdd").focus(); }
  };
  document.getElementById("packReset").onclick = () => { pk.checked = {}; persistExtras(); renderPacking(); };
  document.getElementById("packRegen").onclick = generatePacking;
}

// ---------------------------------------------------------------------------
// Essentials: visa, money, language, emergency, plugs, SIM, apps, safety…
// ---------------------------------------------------------------------------
let essentialsLoading = false;
async function generateEssentials() {
  const el = document.getElementById("essentialsPanel");
  essentialsLoading = true;
  panelLoading(el, "Gathering visa, money, language and safety info…");
  try {
    const data = await postJSON("/api/essentials", { itinerary: state.itinerary });
    state.extras.essentials = data.essentials;
    persistExtras();
    if (tabs.current === "essentials") renderEssentials();
  } catch (e) {
    panelError(el, e.message, "Try again", generateEssentials);
  } finally {
    essentialsLoading = false;
  }
}
function renderEssentials() {
  const el = document.getElementById("essentialsPanel");
  const e = state.extras.essentials;
  if (!e) { if (!essentialsLoading) generateEssentials(); return; }
  const list = (arr) => (arr || []).filter(Boolean).map(x => `<li>${escapeHtml(typeof x === "string" ? x : JSON.stringify(x))}</li>`).join("");
  const box = (icon, title, inner, cls = "") => inner ? `<div class="ess-card ${cls}"><h4>${icon} ${title}</h4>${inner}</div>` : "";
  el.innerHTML = `
    <div class="ess-head">
      <div><h3>Travel essentials · ${escapeHtml(state.itinerary.destination)}</h3>
      <p class="step-sub">AI-compiled; verify visa and health rules on official government sites before you travel.</p></div>
      <button type="button" class="btn btn-ghost btn-sm" id="essRegen">↻ Refresh</button>
    </div>
    <div class="ess-grid">
      ${box("🛂", "Visa & entry", e.visa ? `<p>${escapeHtml(e.visa)}</p>` : "", "span-2 warn")}
      ${box("🚨", "Emergency numbers", e.emergency?.length ? `<ul class="emerg">${e.emergency.map(x => `<li><span>${escapeHtml(x.service)}</span><a href="tel:${escapeHtml(String(x.number).replace(/[^0-9+]/g, ""))}">${escapeHtml(x.number)}</a></li>`).join("")}</ul>` : "")}
      ${box("💱", "Money", e.currency ? `<p><strong>${escapeHtml(e.currency.name || "")} (${escapeHtml(e.currency.code || "")})</strong></p><p>${escapeHtml(e.currency.cash_vs_card || "")}</p>` : "")}
      ${box("🗣", `Useful phrases${e.language?.name ? ` · ${escapeHtml(e.language.name)}` : ""}`, e.language?.phrases?.length ? `<table class="phrases">${e.language.phrases.map(p => `<tr><td><strong>${escapeHtml(p.phrase)}</strong><small>${escapeHtml(p.pronunciation || "")}</small></td><td>${escapeHtml(p.meaning || "")}</td></tr>`).join("")}</table>` : "", "span-2")}
      ${box("🔌", "Power & plugs", e.power ? `<p>${escapeHtml(e.power)}</p>` : "")}
      ${box("📶", "SIM & internet", e.connectivity ? `<p>${escapeHtml(e.connectivity)}</p>` : "")}
      ${box("📱", "Handy apps", e.apps?.length ? `<ul>${e.apps.map(a => `<li><strong>${escapeHtml(a.name)}</strong> · ${escapeHtml(a.use || "")}</li>`).join("")}</ul>` : "")}
      ${box("📅", "Best time to visit", e.best_time ? `<p>${escapeHtml(e.best_time)}</p>` : "")}
      ${box("🙏", "Etiquette", e.etiquette?.length ? `<ul>${list(e.etiquette)}</ul>` : "")}
      ${box("🛡", "Safety & scams", e.safety?.length ? `<ul>${list(e.safety)}</ul>` : "")}
      ${box("💊", "Health", e.health?.length ? `<ul>${list(e.health)}</ul>` : "")}
    </div>`;
  document.getElementById("essRegen").onclick = generateEssentials;
}

// ---------------------------------------------------------------------------
// Ask AI (streaming chat about this trip)
// ---------------------------------------------------------------------------
const chatEls = { log: document.getElementById("chatLog"), form: document.getElementById("chatForm"),
  input: document.getElementById("chatInput"), send: document.getElementById("chatSend"), suggest: document.getElementById("chatSuggest") };
let chatBusy = false;
function formatChat(text) {
  const lines = escapeHtml(text).split("\n");
  let html = "", inList = false;
  for (const raw of lines) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    if (/^\s*[-•*]\s+/.test(line)) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${line.replace(/^\s*[-•*]\s+/, "")}</li>`;
    } else {
      if (inList) { html += "</ul>"; inList = false; }
      if (line.trim()) html += `<p>${line}</p>`;
    }
  }
  return html + (inList ? "</ul>" : "");
}
function renderChat() {
  const msgs = state.extras.chat || [];
  const it = state.itinerary;
  chatEls.log.innerHTML = msgs.length ? msgs.map(m => `
    <div class="msg ${m.role}">${m.role === "assistant" ? '<span class="avatar">🧭</span>' : ""}<div class="bubble">${formatChat(m.content)}</div></div>`).join("")
    : `<div class="chat-empty"><div class="empty-icon">💬</div><h3>Ask anything about your ${escapeHtml(it.destination)} trip</h3>
       <p class="step-sub">Food, getting around, what to wear, rainy-day backups, how to save money…</p></div>`;
  const qs = [
    "What should I book in advance?",
    "Best local dishes I must try?",
    "Rainy-day backup plan?",
    "How do I get from the airport/station to my stay?",
    "Is this plan OK for a tight budget?",
    "What scams should I watch out for?",
  ];
  chatEls.suggest.innerHTML = qs.map(q => `<button type="button" class="chip">${q}</button>`).join("") +
    (msgs.length ? `<button type="button" class="chip clear-chat">🗑 Clear chat</button>` : "");
  chatEls.log.scrollTop = chatEls.log.scrollHeight;
}
chatEls.suggest.addEventListener("click", e => {
  const c = e.target.closest(".chip");
  if (!c) return;
  if (c.classList.contains("clear-chat")) { state.extras.chat = []; persistExtras(); renderChat(); return; }
  sendChat(c.textContent);
});
chatEls.form.addEventListener("submit", e => { e.preventDefault(); sendChat(chatEls.input.value); });
async function sendChat(text) {
  text = text.trim();
  if (!text || chatBusy) return;
  chatBusy = true;
  chatEls.send.disabled = true;
  chatEls.input.value = "";
  state.extras.chat = state.extras.chat || [];
  state.extras.chat.push({ role: "user", content: text });
  renderChat();
  const bubble = document.createElement("div");
  bubble.className = "msg assistant";
  bubble.innerHTML = `<span class="avatar">🧭</span><div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div>`;
  chatEls.log.appendChild(bubble);
  chatEls.log.scrollTop = chatEls.log.scrollHeight;
  let answer = "";
  try {
    const res = await fetch("/api/chat/stream", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itinerary: { ...cleanForAI(state.itinerary), _meta: state.itinerary._meta }, messages: state.extras.chat }),
    });
    if (!res.ok) { let m = "Chat failed."; try { m = (await res.json()).error || m; } catch {} throw new Error(m); }
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        const ev = JSON.parse(line);
        if (ev.type === "token") {
          answer += ev.text;
          bubble.querySelector(".bubble").innerHTML = formatChat(answer);
          chatEls.log.scrollTop = chatEls.log.scrollHeight;
        } else if (ev.type === "error") throw new Error(ev.error);
      }
    }
    if (!answer.trim()) throw new Error("The AI returned an empty answer. Try rephrasing.");
    state.extras.chat.push({ role: "assistant", content: answer.trim() });
    state.extras.chat = state.extras.chat.slice(-30);
    persistExtras();
  } catch (e) {
    state.extras.chat.pop(); // drop the unanswered question so it can be retried
    chatEls.input.value = text;
    toast(e.message, "error");
  } finally {
    chatBusy = false;
    chatEls.send.disabled = false;
    if (tabs.current === "chat") renderChat();
  }
}

// ---------------------------------------------------------------------------
// Share link (whole itinerary compressed into the URL; no server storage)
// ---------------------------------------------------------------------------
const b64url = {
  enc: (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  dec: (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)),
};
async function compress(str) {
  const stream = new Blob([str]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function decompress(s) {
  const stream = new Blob([b64url.dec(s)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}
document.getElementById("shareBtn").addEventListener("click", async () => {
  if (!("CompressionStream" in window)) { toast("Sharing needs a newer browser", "error"); return; }
  const { _meta } = state.itinerary;
  const payload = { v: 1, it: { ...cleanForAI(state.itinerary), _meta: { start_date: _meta?.start_date, travelers: _meta?.travelers, origin: _meta?.origin, coords: _meta?.coords } } };
  const url = `${location.origin}${location.pathname}#trip=${await compress(JSON.stringify(payload))}`;
  const title = `${state.itinerary.destination} trip plan`;
  if (navigator.share && /Mobi|Android|iPhone/i.test(navigator.userAgent)) {
    try { await navigator.share({ title, url }); return; } catch { /* cancelled */ }
  }
  try { await navigator.clipboard.writeText(url); toast("Share link copied ✓ Anyone with it can view this trip", "success"); }
  catch { prompt("Copy this link:", url); }
});
async function loadSharedTrip() {
  const m = location.hash.match(/^#trip=(.+)$/);
  if (!m || !("DecompressionStream" in window)) return;
  try {
    const payload = JSON.parse(await decompress(m[1]));
    if (!payload?.it?.days) throw new Error();
    state.itinerary = payload.it;
    state.tripId = `t${Date.now()}`;
    state.history = [];
    state.extras = {};
    saveTrip();
    showResults();
    toast("Shared trip opened and saved to My trips ✓", "success");
  } catch {
    toast("That share link looks broken", "error");
  } finally {
    history.replaceState(null, "", location.pathname);
  }
}
loadSharedTrip();
