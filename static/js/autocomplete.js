// ===========================================================================
// Place autocomplete — instant matches from a built-in list of popular
// destinations, enriched with worldwide results from the free Photon geocoder
// (OpenStreetMap data, no API key). Works offline with just the built-in list.
// ===========================================================================
(function () {
  const POPULAR = [
    // India
    "Goa, India", "Jaipur, India", "Udaipur, India", "Jodhpur, India", "Jaisalmer, India", "Agra, India",
    "Varanasi, India", "Rishikesh, India", "Haridwar, India", "Manali, India", "Shimla, India", "Kasol, India",
    "Dharamshala, India", "McLeod Ganj, India", "Leh, Ladakh, India", "Srinagar, Kashmir, India", "Gulmarg, India",
    "Amritsar, India", "Mussoorie, India", "Nainital, India", "Auli, India", "Spiti Valley, India",
    "Darjeeling, India", "Gangtok, Sikkim, India", "Shillong, India", "Kaziranga, India", "Tawang, India",
    "Munnar, Kerala, India", "Alleppey, Kerala, India", "Kochi, Kerala, India", "Varkala, India", "Wayanad, India",
    "Coorg, India", "Ooty, India", "Kodaikanal, India", "Hampi, India", "Gokarna, India", "Pondicherry, India",
    "Mysuru, India", "Bengaluru, India", "Chennai, India", "Mumbai, India", "Pune, India", "Lonavala, India",
    "New Delhi, India", "Kolkata, India", "Hyderabad, India", "Andaman Islands, India", "Lakshadweep, India",
    "Rann of Kutch, India", "Ahmedabad, India", "Khajuraho, India", "Ranthambore, India", "Pushkar, India",
    // Asia
    "Bali, Indonesia", "Bangkok, Thailand", "Phuket, Thailand", "Chiang Mai, Thailand", "Krabi, Thailand",
    "Singapore", "Kuala Lumpur, Malaysia", "Langkawi, Malaysia", "Hanoi, Vietnam", "Ho Chi Minh City, Vietnam",
    "Hoi An, Vietnam", "Ha Long Bay, Vietnam", "Siem Reap, Cambodia", "Luang Prabang, Laos",
    "Tokyo, Japan", "Kyoto, Japan", "Osaka, Japan", "Hokkaido, Japan", "Seoul, South Korea", "Jeju, South Korea",
    "Hong Kong", "Taipei, Taiwan", "Beijing, China", "Shanghai, China", "Manila, Philippines", "Palawan, Philippines",
    "Kathmandu, Nepal", "Pokhara, Nepal", "Thimphu, Bhutan", "Paro, Bhutan", "Colombo, Sri Lanka", "Ella, Sri Lanka",
    "Maldives", "Dubai, UAE", "Abu Dhabi, UAE", "Doha, Qatar", "Muscat, Oman", "Petra, Jordan",
    "Istanbul, Türkiye", "Cappadocia, Türkiye", "Baku, Azerbaijan", "Tbilisi, Georgia", "Almaty, Kazakhstan",
    // Europe
    "Paris, France", "Nice, France", "London, UK", "Edinburgh, UK", "Amsterdam, Netherlands", "Brussels, Belgium",
    "Rome, Italy", "Venice, Italy", "Florence, Italy", "Amalfi Coast, Italy", "Milan, Italy", "Barcelona, Spain",
    "Madrid, Spain", "Seville, Spain", "Lisbon, Portugal", "Porto, Portugal", "Santorini, Greece", "Athens, Greece",
    "Mykonos, Greece", "Interlaken, Switzerland", "Zurich, Switzerland", "Lucerne, Switzerland", "Vienna, Austria",
    "Salzburg, Austria", "Prague, Czechia", "Budapest, Hungary", "Berlin, Germany", "Munich, Germany",
    "Copenhagen, Denmark", "Stockholm, Sweden", "Oslo, Norway", "Tromsø, Norway", "Reykjavík, Iceland",
    "Dubrovnik, Croatia", "Ljubljana, Slovenia", "Kraków, Poland", "Dublin, Ireland",
    // Americas, Africa, Oceania
    "New York, USA", "Los Angeles, USA", "San Francisco, USA", "Las Vegas, USA", "Miami, USA", "Hawaii, USA",
    "Toronto, Canada", "Vancouver, Canada", "Banff, Canada", "Cancún, Mexico", "Mexico City, Mexico",
    "Cusco, Peru", "Rio de Janeiro, Brazil", "Buenos Aires, Argentina", "Patagonia, Argentina",
    "Cape Town, South Africa", "Marrakech, Morocco", "Cairo, Egypt", "Zanzibar, Tanzania", "Nairobi, Kenya",
    "Mauritius", "Seychelles", "Sydney, Australia", "Melbourne, Australia", "Queenstown, New Zealand", "Fiji",
  ];

  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const POP_NORM = POPULAR.map((p) => [p, norm(p)]);

  function localMatches(q) {
    const nq = norm(q.trim());
    if (!nq) return [];
    const starts = [], contains = [];
    for (const [label, n] of POP_NORM) {
      if (n.startsWith(nq) || n.split(/[ ,]+/).some((w) => w.startsWith(nq))) starts.push(label);
      else if (nq.length >= 3 && n.includes(nq)) contains.push(label);
    }
    return [...starts, ...contains].slice(0, 5).map((label) => ({ label, sub: "Popular destination", source: "local" }));
  }

  const cache = new Map();
  async function remoteMatches(q, signal) {
    const key = norm(q.trim());
    if (cache.has(key)) return cache.get(key);
    const layers = ["city", "locality", "district", "county", "state", "country"].map((l) => `&layer=${l}`).join("");
    const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&lang=en${layers}`, { signal });
    if (!res.ok) throw new Error("geocoder");
    const data = await res.json();
    const out = (data.features || []).map((f) => {
      const p = f.properties || {};
      const parts = [p.name, p.type !== "state" && p.state !== p.name ? p.state : null, p.type !== "country" ? p.country : null]
        .filter(Boolean);
      const typeLabel = { city: "City", locality: "Town", district: "Area", county: "Region", state: "State / region", country: "Country" }[p.type] || "Place";
      return {
        label: [...new Set(parts)].join(", "),
        sub: typeLabel,
        lat: f.geometry?.coordinates?.[1], lon: f.geometry?.coordinates?.[0],
        countrycode: p.countrycode, source: "remote",
      };
    });
    cache.set(key, out);
    return out;
  }

  function highlight(label, q) {
    const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const i = norm(label).indexOf(norm(q.trim()));
    if (i < 0 || !q.trim()) return esc(label);
    const j = i + q.trim().length;
    return `${esc(label.slice(0, i))}<mark>${esc(label.slice(i, j))}</mark>${esc(label.slice(j))}`;
  }

  window.attachAutocomplete = function (input, { onSelect } = {}) {
    const wrap = input.closest(".ac-wrap") || input.parentElement;
    const list = document.createElement("ul");
    list.className = "ac-list";
    list.setAttribute("role", "listbox");
    list.id = `${input.id}-ac`;
    input.setAttribute("aria-controls", list.id);
    wrap.appendChild(list);

    let items = [], active = -1, timer, ctrl, lastQ = "";

    function close() {
      list.classList.remove("open");
      input.setAttribute("aria-expanded", "false");
      active = -1;
    }
    function render(q) {
      if (!items.length) { close(); return; }
      list.innerHTML = items.map((it, i) => `
        <li role="option" id="${list.id}-${i}" class="ac-item ${i === active ? "active" : ""}" data-i="${i}" aria-selected="${i === active}">
          <span class="ac-pin">${it.source === "local" ? "★" : "📍"}</span>
          <span class="ac-text"><span class="ac-label">${highlight(it.label, q)}</span><span class="ac-sub">${it.sub}</span></span>
        </li>`).join("");
      list.classList.add("open");
      input.setAttribute("aria-expanded", "true");
      input.setAttribute("aria-activedescendant", active >= 0 ? `${list.id}-${active}` : "");
    }
    function merge(local, remote) {
      const seen = new Set();
      return [...local, ...remote].filter((it) => {
        const k = norm(it.label).replace(/[^a-z]/g, "");
        if (!it.label || seen.has(k)) return false;
        seen.add(k);
        return true;
      }).slice(0, 7);
    }
    function choose(i) {
      const it = items[i];
      if (!it) return;
      input.value = it.label;
      input.dataset.picked = it.label;
      close();
      onSelect?.(it);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    input.addEventListener("input", () => {
      const q = input.value;
      if (input.dataset.picked === q) return;   // value just set by choose()
      delete input.dataset.picked;
      lastQ = q;
      clearTimeout(timer);
      ctrl?.abort();
      if (q.trim().length < 1) { items = []; close(); return; }
      const local = localMatches(q);
      items = local; active = -1; render(q);
      if (q.trim().length < 2) return;
      timer = setTimeout(async () => {
        ctrl = new AbortController();
        try {
          const remote = await remoteMatches(q, ctrl.signal);
          if (lastQ !== q) return;
          items = merge(local, remote); active = -1; render(q);
        } catch { /* offline or blocked: keep local suggestions */ }
      }, 220);
    });
    input.addEventListener("keydown", (e) => {
      if (!list.classList.contains("open")) return;
      if (e.key === "ArrowDown") { e.preventDefault(); active = (active + 1) % items.length; render(input.value); }
      else if (e.key === "ArrowUp") { e.preventDefault(); active = (active - 1 + items.length) % items.length; render(input.value); }
      else if (e.key === "Enter" && active >= 0) { e.preventDefault(); e.stopPropagation(); choose(active); }
      else if (e.key === "Escape") { close(); }
      else if (e.key === "Tab" && active >= 0) { choose(active); }
    });
    list.addEventListener("mousedown", (e) => {
      const li = e.target.closest(".ac-item");
      if (li) { e.preventDefault(); choose(parseInt(li.dataset.i, 10)); }
    });
    input.addEventListener("blur", () => setTimeout(close, 120));
    input.addEventListener("focus", () => { if (input.value.trim() && items.length && !input.dataset.picked) render(input.value); });
  };
})();
