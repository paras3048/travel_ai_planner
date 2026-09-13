# TripCraft AI — Travel Itinerary Planner (Flask + Ollama Cloud)

A full-stack app that asks a few questions (destination, duration, budget,
traveler type, pace, interests, notes) and generates a **detailed**
day-by-day travel itinerary using **Ollama Cloud's free API** — no local
GPU/model download required. Each activity comes with a description,
duration estimate, and cost estimate; each day includes meal suggestions
and a day cost estimate; the trip gets a total cost estimate and a list of
practical tips. You can then refine the itinerary conversationally ("make
day 2 more relaxed", "add more food spots"...) and download the final plan
as a PDF, entirely in the browser.

- **Backend**: Python (Flask) — talks to Ollama Cloud's REST API
- **Frontend**: plain HTML/CSS/JS wizard, served by Flask (no separate frontend server needed)
- **PDF export**: client-side (jsPDF), no server involved

```
travel-planner/
├── app.py                 # Flask app + API routes + Ollama integration
├── requirements.txt
├── Procfile                # for hosting platforms (gunicorn)
├── .env.example             # copy to .env for local dev
├── .gitignore
├── templates/
│   └── index.html
└── static/
    ├── css/style.css
    └── js/app.js
```

---

## 1. Get a free Ollama Cloud API key

1. Go to **https://ollama.com**, sign up / sign in.
2. Go to **https://ollama.com/settings/keys** and create an API key. Copy it
   somewhere safe — you won't be able to see it again after this.
3. That's the only "API key" this project needs. No other account or
   provider is required.

Ollama Cloud gives free daily usage on hosted open models (e.g.
`gpt-oss:20b`, `gpt-oss:120b`, and others). You can see the full list of
available cloud models at **https://ollama.com/search?c=cloud**. The default
model here is `gpt-oss:20b` — fast and good quality; swap in `gpt-oss:120b`
in your `.env` if you want even higher quality (slower) responses.

---

## 2. Run it locally (do this first)

```bash
cd travel-planner

# create a virtual environment (recommended)
python3 -m venv venv
source venv/bin/activate        # on Windows: venv\Scripts\activate

# install dependencies
pip install -r requirements.txt

# create your local env file
cp .env.example .env
```

Open `.env` and paste in your key:
```
OLLAMA_HOST=https://ollama.com
OLLAMA_MODEL=gpt-oss:20b
OLLAMA_API_KEY=paste_your_real_key_here
PORT=5000
FLASK_DEBUG=true
```

Then run:
```bash
python app.py
```

Open **http://localhost:5000** in your browser. That's it — one server does
both the frontend and the API. The header badge tells you if Ollama Cloud is
reachable and whether it detected your API key.

> **Prefer a fully local/offline model instead?** You still can — install
> Ollama from ollama.com/download, `ollama pull llama3.1`, and set
> `OLLAMA_HOST=http://localhost:11434` / `OLLAMA_MODEL=llama3.1` in `.env`
> (leave `OLLAMA_API_KEY` blank). The code supports both modes with zero
> changes — it's purely a config switch.

---

## 3. How the app is structured (quick tour)

- `app.py` exposes three endpoints:
  - `GET /api/health` — checks if Ollama is reachable and reports cloud vs. local mode, used for the status badge
  - `POST /api/generate-itinerary` — takes your wizard answers, prompts the model
    with a strict, detailed JSON schema, and returns a structured itinerary
  - `POST /api/customize-itinerary` — takes the current itinerary + a free-text
    change request, and asks the model to return an updated itinerary in the same
    schema (this powers the "tweak it" box)
- The prompt (`SYSTEM_PROMPT` in `app.py`) explicitly asks for **detail**: named
  real places (not "a local restaurant"), per-activity duration and cost
  estimates, transit notes between stops, all 3 meals per day with
  suggestions, a day cost estimate, and an overall trip cost estimate.
- The frontend (`templates/index.html` + `static/js/app.js`) is a step-by-step
  wizard that collects your answers, then renders the returned JSON as day
  cards. The "Save as PDF" button builds a PDF **in the browser** with jsPDF —
  no server round trip, so it costs nothing and needs no extra backend code.

---

## 4. Push to GitHub — where the API key goes (and doesn't go)

Your Ollama Cloud API key must **never** be committed to GitHub. This repo
is already set up so that's hard to get wrong:

- `.env` is listed in `.gitignore` — it will **never** be pushed to GitHub,
  even with `git add .`.
- `.env.example` **is** committed — it documents which variables exist, with
  a placeholder instead of your real key.
- `app.py` reads the key via `os.getenv("OLLAMA_API_KEY")`, so the real value
  only ever lives in your local `.env` file, or in your hosting platform's
  "Environment Variables" dashboard once deployed (see below).

To push:
```bash
git init
git add .
git commit -m "Initial commit: TripCraft AI"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

Before/after committing, run `git status` — `.env` should **not** appear in
the list. If it does, you likely edited `.gitignore` by mistake, or created
`.env` before initializing git in a folder where `.gitignore` wasn't picked
up yet — remove it from tracking with `git rm --cached .env` if that happens.

---

## 5. Hosting for free (once local testing works)

Because you're using Ollama **Cloud** (a normal HTTPS API), hosting is much
simpler than a local-Ollama setup would be — the deployed app just needs
internet access and your API key, nothing more (no tunnels needed). Using
**Render** as an example (Railway, Fly.io, and PythonAnywhere work the same
way):

1. Push your code to GitHub (see step 4).
2. Go to **https://render.com** → sign in with GitHub → **New → Web Service**.
3. Pick your repo.
4. Configure:
   - **Build command**: `pip install -r requirements.txt`
   - **Start command**: `gunicorn app:app` (already provided via `Procfile`)
   - **Environment variables** — this is where the key goes. In Render's
     dashboard, open the **Environment** tab and add:
     - `OLLAMA_HOST` → `https://ollama.com`
     - `OLLAMA_MODEL` → `gpt-oss:20b` (or whichever model you want)
     - `OLLAMA_API_KEY` → your real key from step 1
     - `FLASK_DEBUG` → `false`
   - **Never** put these values in `app.py` or anywhere in the repo — only
     in this dashboard.
5. Deploy. Render will give you a public URL like `https://tripcraft-ai.onrender.com`.

Other equally good free options: **Railway**, **Fly.io**, **PythonAnywhere**.
The pattern is identical everywhere: your code only ever calls
`os.getenv("OLLAMA_API_KEY")` — the actual secret is pasted into that
platform's "Environment Variables" / "Config Vars" / "Secrets" panel, never
into a file that gets committed.

> Free tiers on these platforms often "sleep" the app after inactivity, so
> the first request after a while may take a few extra seconds to wake up —
> that's normal and not a bug in the app.

---

## 6. Customizing further

- **Change the model / quality vs. speed**: edit `OLLAMA_MODEL` in `.env`
  (local) or the host's env vars (deployed) — no code changes needed. See
  https://ollama.com/search?c=cloud for the current list of cloud models.
- **Adjust how detailed the itinerary is**: tweak `SYSTEM_PROMPT` in `app.py`
  — it already asks for per-activity cost/duration, meals, and cost
  estimates; you can ask for even more (e.g. opening hours, booking links)
  the same way.
- **Add more wizard questions**: add a `.step` block in `templates/index.html`,
  wire it into `state.data` in `static/js/app.js`, and include it in the
  prompt built in `generate_itinerary()` in `app.py`.
