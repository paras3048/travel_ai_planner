// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  step: 1,
  totalSteps: 8,
  data: {
    destination: "",
    duration: 5,
    budget: "",
    traveler_type: "",
    pace: "",
    interests: [],
    notes: ""
  },
  itinerary: null
};

const els = {
  wizard: document.getElementById("wizard"),
  loading: document.getElementById("loading"),
  results: document.getElementById("results"),
  progressBar: document.getElementById("progressBar"),
  progressSteps: document.getElementById("progressSteps"),
  wizardError: document.getElementById("wizardError"),
  prevBtn: document.getElementById("prevBtn"),
  nextBtn: document.getElementById("nextBtn"),
  generateBtn: document.getElementById("generateBtn"),
  destination: document.getElementById("destination"),
  duration: document.getElementById("duration"),
  notes: document.getElementById("notes"),
  reviewSummary: document.getElementById("reviewSummary"),
  ollamaStatus: document.getElementById("ollamaStatus"),
  resultTitle: document.getElementById("resultTitle"),
  resultSummary: document.getElementById("resultSummary"),
  daysContainer: document.getElementById("daysContainer"),
  tipsCard: document.getElementById("tipsCard"),
  tipsList: document.getElementById("tipsList"),
  downloadPdfBtn: document.getElementById("downloadPdfBtn"),
  startOverBtn: document.getElementById("startOverBtn"),
  customizeInput: document.getElementById("customizeInput"),
  customizeBtn: document.getElementById("customizeBtn"),
  customizeError: document.getElementById("customizeError"),
};

// ---------------------------------------------------------------------------
// Ollama health check
// ---------------------------------------------------------------------------
async function checkOllamaStatus() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    const mode = data.using_cloud ? "Cloud" : "Local";
    if (data.ollama_reachable) {
      els.ollamaStatus.classList.add("online");
      els.ollamaStatus.classList.remove("offline");
      els.ollamaStatus.querySelector(".status-text").textContent = `Ollama ${mode} connected (${data.model})`;
    } else {
      els.ollamaStatus.classList.add("offline");
      els.ollamaStatus.classList.remove("online");
      const hint = data.using_cloud && !data.api_key_set ? " — set OLLAMA_API_KEY" : "";
      els.ollamaStatus.querySelector(".status-text").textContent = `Ollama ${mode} not reachable${hint}`;
    }
  } catch (e) {
    els.ollamaStatus.classList.add("offline");
    els.ollamaStatus.querySelector(".status-text").textContent = "Backend not reachable";
  }
}
checkOllamaStatus();

// ---------------------------------------------------------------------------
// Wizard navigation
// ---------------------------------------------------------------------------
function showStep(n) {
  document.querySelectorAll(".step").forEach(s => {
    s.classList.toggle("active", parseInt(s.dataset.step) === n);
  });
  els.progressBar.style.width = `${(n / state.totalSteps) * 100}%`;
  els.progressSteps.textContent = `Step ${n} of ${state.totalSteps}`;
  els.prevBtn.style.visibility = n === 1 ? "hidden" : "visible";
  els.nextBtn.style.display = n === state.totalSteps ? "none" : "inline-block";
  els.generateBtn.style.display = n === state.totalSteps ? "inline-block" : "none";
  hideWizardError();
  if (n === state.totalSteps) renderReview();
}

function showWizardError(msg) {
  els.wizardError.textContent = msg;
  els.wizardError.style.display = "block";
}
function hideWizardError() {
  els.wizardError.style.display = "none";
}

function validateStep(n) {
  switch (n) {
    case 1:
      state.data.destination = els.destination.value.trim();
      if (!state.data.destination) return "Please enter a destination.";
      break;
    case 2:
      state.data.duration = parseInt(els.duration.value, 10);
      if (!state.data.duration || state.data.duration < 1) return "Please enter a valid number of days.";
      break;
    case 3:
      if (!state.data.budget) return "Please select a budget.";
      break;
    case 4:
      if (!state.data.traveler_type) return "Please select who's traveling.";
      break;
    case 5:
      if (!state.data.pace) return "Please select a pace.";
      break;
    case 6:
      if (state.data.interests.length === 0) return "Please select at least one interest.";
      break;
    case 7:
      state.data.notes = els.notes.value.trim();
      break;
  }
  return null;
}

els.nextBtn.addEventListener("click", () => {
  const err = validateStep(state.step);
  if (err) { showWizardError(err); return; }
  if (state.step < state.totalSteps) {
    state.step++;
    showStep(state.step);
  }
});

els.prevBtn.addEventListener("click", () => {
  if (state.step > 1) {
    state.step--;
    showStep(state.step);
  }
});

// Duration stepper buttons
document.getElementById("durationMinus").addEventListener("click", () => {
  els.duration.value = Math.max(1, parseInt(els.duration.value || 1, 10) - 1);
});
document.getElementById("durationPlus").addEventListener("click", () => {
  els.duration.value = Math.min(30, parseInt(els.duration.value || 1, 10) + 1);
});

// Single-select and multi-select option cards
document.querySelectorAll(".option-grid").forEach(grid => {
  const field = grid.dataset.field;
  const isMulti = grid.dataset.multi === "true";
  grid.querySelectorAll(".option-card").forEach(card => {
    card.addEventListener("click", () => {
      const value = card.dataset.value;
      if (isMulti) {
        card.classList.toggle("selected");
        if (card.classList.contains("selected")) {
          state.data.interests.push(value);
        } else {
          state.data.interests = state.data.interests.filter(v => v !== value);
        }
      } else {
        grid.querySelectorAll(".option-card").forEach(c => c.classList.remove("selected"));
        card.classList.add("selected");
        state.data[field] = value;
      }
      hideWizardError();
    });
  });
});

function renderReview() {
  const d = state.data;
  const rows = [
    ["Destination", d.destination],
    ["Duration", `${d.duration} day${d.duration > 1 ? "s" : ""}`],
    ["Budget", d.budget],
    ["Traveler type", d.traveler_type],
    ["Pace", d.pace],
    ["Interests", d.interests.join(", ")],
    ["Notes", d.notes || "—"],
  ];
  els.reviewSummary.innerHTML = rows.map(([label, value]) => `
    <div class="review-row"><span class="label">${label}</span><span class="value">${escapeHtml(String(value))}</span></div>
  `).join("");
}

// ---------------------------------------------------------------------------
// Generate itinerary
// ---------------------------------------------------------------------------
els.generateBtn.addEventListener("click", async () => {
  hideWizardError();
  els.wizard.style.display = "none";
  els.loading.style.display = "block";
  document.getElementById("loadingText").textContent = "Crafting your itinerary with AI…";

  try {
    const res = await fetch("/api/generate-itinerary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.data)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    state.itinerary = data.itinerary;
    renderResults();
    els.loading.style.display = "none";
    els.results.style.display = "block";
  } catch (e) {
    els.loading.style.display = "none";
    els.wizard.style.display = "block";
    showWizardError(e.message);
  }
});

// ---------------------------------------------------------------------------
// Render results
// ---------------------------------------------------------------------------
function renderResults() {
  const it = state.itinerary;
  els.resultTitle.textContent = `${it.destination} — ${it.duration_days} Day Itinerary`;
  const summaryParts = [it.summary || ""];
  if (it.estimated_total_cost) summaryParts.push(`Estimated total: ${it.estimated_total_cost}`);
  els.resultSummary.textContent = summaryParts.filter(Boolean).join("  ·  ");

  els.daysContainer.innerHTML = (it.days || []).map(day => `
    <div class="day-card">
      <h3>
        <span class="day-num">DAY ${day.day}</span> ${escapeHtml(day.title || "")}
        ${day.estimated_day_cost ? `<span class="day-cost">~${escapeHtml(day.estimated_day_cost)}</span>` : ""}
      </h3>
      ${(day.activities || []).map(act => `
        <div class="activity">
          <div class="time">${escapeHtml(act.time || "")}</div>
          <div>
            <p class="activity-name">${escapeHtml(act.activity || "")}</p>
            ${act.description ? `<p class="activity-desc">${escapeHtml(act.description)}</p>` : ""}
            <p class="activity-meta">
              ${act.location ? `<span>📍 ${escapeHtml(act.location)}</span>` : ""}
              ${act.duration_estimate ? `<span>⏱ ${escapeHtml(act.duration_estimate)}</span>` : ""}
              ${act.cost_estimate ? `<span>💵 ${escapeHtml(act.cost_estimate)}</span>` : ""}
            </p>
          </div>
        </div>
      `).join("")}
      ${(day.meals && day.meals.length) ? `
        <div class="meals-row">
          ${day.meals.map(m => `
            <div class="meal-chip">
              <strong>${escapeHtml(m.meal || "Meal")}:</strong> ${escapeHtml(m.suggestion || "")}
              ${m.description ? `<span class="meal-desc">${escapeHtml(m.description)}</span>` : ""}
              ${m.cost_estimate ? `<span class="meal-cost">${escapeHtml(m.cost_estimate)}</span>` : ""}
            </div>
          `).join("")}
        </div>
      ` : ""}
    </div>
  `).join("");

  if (it.tips && it.tips.length) {
    els.tipsList.innerHTML = it.tips.map(t => `<li>${escapeHtml(t)}</li>`).join("");
    els.tipsCard.style.display = "block";
  } else {
    els.tipsCard.style.display = "none";
  }
}

// ---------------------------------------------------------------------------
// Customize itinerary
// ---------------------------------------------------------------------------
async function applyCustomization(text) {
  if (!text.trim()) return;
  els.customizeError.style.display = "none";
  els.customizeBtn.disabled = true;
  els.customizeBtn.textContent = "Applying…";

  try {
    const res = await fetch("/api/customize-itinerary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itinerary: state.itinerary, request: text })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    state.itinerary = data.itinerary;
    renderResults();
    els.customizeInput.value = "";
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (e) {
    els.customizeError.textContent = e.message;
    els.customizeError.style.display = "block";
  } finally {
    els.customizeBtn.disabled = false;
    els.customizeBtn.textContent = "Apply";
  }
}

els.customizeBtn.addEventListener("click", () => applyCustomization(els.customizeInput.value));
els.customizeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") applyCustomization(els.customizeInput.value);
});
document.querySelectorAll(".chip").forEach(chip => {
  chip.addEventListener("click", () => applyCustomization(chip.textContent));
});

// ---------------------------------------------------------------------------
// Start over
// ---------------------------------------------------------------------------
els.startOverBtn.addEventListener("click", () => {
  state.step = 1;
  state.data = { destination: "", duration: 5, budget: "", traveler_type: "", pace: "", interests: [], notes: "" };
  state.itinerary = null;
  els.destination.value = "";
  els.duration.value = 5;
  els.notes.value = "";
  document.querySelectorAll(".option-card").forEach(c => c.classList.remove("selected"));
  els.results.style.display = "none";
  els.wizard.style.display = "block";
  showStep(1);
});

// ---------------------------------------------------------------------------
// PDF export (client-side, no server round trip)
// ---------------------------------------------------------------------------
els.downloadPdfBtn.addEventListener("click", () => {
  const it = state.itinerary;
  if (!it) return;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const marginX = 48;
  let y = 56;
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  const maxWidth = pageWidth - marginX * 2;

  function ensureSpace(lineHeight) {
    if (y + lineHeight > pageHeight - 48) {
      doc.addPage();
      y = 56;
    }
  }
  function writeText(text, opts = {}) {
    const { size = 11, style = "normal", color = [30, 30, 30], gap = 16 } = opts;
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(text, maxWidth);
    lines.forEach(line => {
      ensureSpace(gap);
      doc.text(line, marginX, y);
      y += gap;
    });
  }

  writeText(`${it.destination} — ${it.duration_days} Day Itinerary`, { size: 20, style: "bold", gap: 26 });
  writeText(`Budget: ${it.budget}   |   Traveler: ${it.traveler_type}   |   Pace: ${it.pace}`, { size: 10, color: [100, 100, 100], gap: 16 });
  y += 6;
  if (it.summary) {
    writeText(it.summary, { size: 11, color: [60, 60, 60], gap: 15 });
  }
  if (it.estimated_total_cost) {
    writeText(`Estimated total cost (per person): ${it.estimated_total_cost}`, { size: 10.5, style: "bold", color: [60, 60, 60], gap: 15 });
  }
  y += 10;

  (it.days || []).forEach(day => {
    y += 6;
    ensureSpace(24);
    const dayHeader = `Day ${day.day}: ${day.title || ""}` + (day.estimated_day_cost ? `  (~${day.estimated_day_cost})` : "");
    writeText(dayHeader, { size: 14, style: "bold", gap: 20 });
    (day.activities || []).forEach(act => {
      writeText(`${act.time || ""} — ${act.activity || ""}`, { size: 11.5, style: "bold", gap: 15 });
      if (act.description) writeText(act.description, { size: 10.5, color: [90, 90, 90], gap: 14 });
      const metaBits = [];
      if (act.location) metaBits.push(`Location: ${act.location}`);
      if (act.duration_estimate) metaBits.push(`Duration: ${act.duration_estimate}`);
      if (act.cost_estimate) metaBits.push(`Cost: ${act.cost_estimate}`);
      if (metaBits.length) writeText(metaBits.join("   |   "), { size: 9.5, color: [130, 130, 130], gap: 14 });
      y += 4;
    });
    if (day.meals && day.meals.length) {
      writeText("Meals:", { size: 10.5, style: "bold", color: [70, 70, 70], gap: 14 });
      day.meals.forEach(m => {
        const line = `${m.meal || "Meal"}: ${m.suggestion || ""}${m.cost_estimate ? ` (${m.cost_estimate})` : ""}`;
        writeText(line, { size: 10, color: [90, 90, 90], gap: 13 });
        if (m.description) writeText(m.description, { size: 9.5, color: [130, 130, 130], gap: 13 });
      });
    }
  });

  if (it.tips && it.tips.length) {
    y += 10;
    ensureSpace(20);
    writeText("Good to know", { size: 14, style: "bold", gap: 20 });
    it.tips.forEach(tip => writeText(`• ${tip}`, { size: 10.5, color: [70, 70, 70], gap: 14 }));
  }

  const filename = `${(it.destination || "itinerary").replace(/[^a-z0-9]+/gi, "_")}_itinerary.pdf`;
  doc.save(filename);
});

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Init
showStep(1);
