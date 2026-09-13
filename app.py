import os
import json
import re
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
import requests
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)

# ---- Config (read from environment) ----
# Ollama Cloud by default: https://ollama.com acts as a remote Ollama host,
# authenticated with an API key. You can still point OLLAMA_HOST at
# http://localhost:11434 for a fully local/offline setup with no key needed.
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "https://ollama.com")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "gpt-oss:20b")
OLLAMA_API_KEY = os.getenv("OLLAMA_API_KEY", "")

SYSTEM_PROMPT = """You are an expert, detail-obsessed travel planner. You must ALWAYS respond with \
valid JSON only (no markdown fences, no explanation text outside the JSON), matching this exact schema:

{
  "destination": "string",
  "duration_days": number,
  "budget": "string",
  "traveler_type": "string",
  "pace": "string",
  "interests": ["string"],
  "summary": "3-4 sentence overview of the overall trip plan and vibe",
  "days": [
    {
      "day": number,
      "title": "short evocative theme for the day",
      "activities": [
        {
          "time": "Morning|Afternoon|Evening|Night",
          "activity": "specific, named activity or place (not generic)",
          "description": "3-4 sentence detailed description: what it is, why it's worth it, what to actually do/see/order there, any insider tips",
          "location": "specific neighbourhood/area, and how to get there from the previous stop (walk/taxi/metro + rough time)",
          "duration_estimate": "e.g. '2 hours'",
          "cost_estimate": "specific price range in local currency and USD, or 'Free'"
        }
      ],
      "meals": [
        {"meal": "Breakfast|Lunch|Dinner", "suggestion": "specific restaurant/dish/area", "description": "1-2 sentences: what to order, why it fits the budget/interests", "cost_estimate": "price range"}
      ],
      "estimated_day_cost": "rough total for the day in local currency and USD, per person"
    }
  ],
  "tips": ["specific, practical tips: local transport passes, tipping norms, weather/packing for the season, safety notes, money-saving tricks, booking-ahead warnings — tailored to this exact destination, budget and traveler type"],
  "estimated_total_cost": "rough total trip cost range per person, local currency and USD"
}

Rules:
- Output ONLY the JSON object. No text before or after it, no markdown code fences.
- Be DETAILED and SPECIFIC everywhere: name real places, neighbourhoods, dishes, and landmarks for the given destination instead of generic placeholders like "local market" or "a nice restaurant". Avoid vague filler sentences.
- Make the plan realistic and geographically sensible — group nearby activities on the same day and mention realistic transit between them.
- The "days" array MUST have exactly duration_days entries, numbered 1..duration_days.
- "pace" affects activity density: relaxed = 3-4 activities/day, balanced = 4-5, fast = 5-7. Always include all 3 meals per day (skip a meal only if an activity already covers it, e.g. a food tour).
- Cost estimates must be consistent with the stated budget category and traveler type (e.g. Family budget trips should suggest kid-friendly, wallet-friendly options).
- Respect any special notes/requirements the user provides — treat them as hard constraints where reasonable (dietary needs, mobility, must-see spots, things to avoid).
"""


def call_ollama(messages, timeout=180):
    """Send a chat request to Ollama (cloud or local) and return the raw text content."""
    url = f"{OLLAMA_HOST}/api/chat"
    headers = {}
    if OLLAMA_API_KEY:
        headers["Authorization"] = f"Bearer {OLLAMA_API_KEY}"
    payload = {
        "model": OLLAMA_MODEL,
        "messages": messages,
        "stream": False,
        "format": "json",
        "options": {"temperature": 0.7},
    }
    resp = requests.post(url, json=payload, headers=headers, timeout=timeout)
    resp.raise_for_status()
    data = resp.json()
    return data.get("message", {}).get("content", "")


def extract_json(text):
    """Ollama with format=json should return clean JSON, but we defensively
    strip any stray text/fences the model might still add."""
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass
    raise ValueError("Model did not return valid JSON")


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/health")
def health():
    """Lets the frontend check whether Ollama is reachable before it tries to generate."""
    headers = {}
    if OLLAMA_API_KEY:
        headers["Authorization"] = f"Bearer {OLLAMA_API_KEY}"
    try:
        r = requests.get(f"{OLLAMA_HOST}/api/tags", headers=headers, timeout=8)
        ollama_ok = r.status_code == 200
    except Exception:
        ollama_ok = False
    return jsonify({
        "status": "ok",
        "ollama_reachable": ollama_ok,
        "model": OLLAMA_MODEL,
        "host": OLLAMA_HOST,
        "using_cloud": OLLAMA_HOST.startswith("https://ollama.com"),
        "api_key_set": bool(OLLAMA_API_KEY),
    })


@app.route("/api/generate-itinerary", methods=["POST"])
def generate_itinerary():
    data = request.get_json(force=True) or {}

    required = ["destination", "duration", "budget", "traveler_type", "pace", "interests"]
    missing = [f for f in required if not data.get(f)]
    if missing:
        return jsonify({"error": f"Missing fields: {', '.join(missing)}"}), 400

    interests = data["interests"]
    user_prompt = f"""Create a travel itinerary with these requirements:
- Destination: {data['destination']}
- Duration: {data['duration']} days
- Budget: {data['budget']}
- Traveler type: {data['traveler_type']}
- Pace: {data['pace']}
- Interests: {', '.join(interests) if isinstance(interests, list) else interests}
- Additional notes: {data.get('notes') or 'None'}

Respond with ONLY the JSON object as per the schema."""

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]

    try:
        raw = call_ollama(messages)
        itinerary = extract_json(raw)
    except requests.exceptions.ConnectionError:
        return jsonify({"error": connection_error_message()}), 502
    except requests.exceptions.HTTPError as e:
        return jsonify({"error": http_error_message(e)}), 502
    except requests.exceptions.Timeout:
        return jsonify({"error": "The model took too long to respond. Try a smaller/faster model."}), 504
    except ValueError as e:
        return jsonify({"error": f"Could not parse itinerary from model output: {str(e)}"}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    return jsonify({"itinerary": itinerary})


@app.route("/api/customize-itinerary", methods=["POST"])
def customize_itinerary():
    data = request.get_json(force=True) or {}
    current_itinerary = data.get("itinerary")
    change_request = data.get("request")

    if not current_itinerary or not change_request:
        return jsonify({"error": "Both 'itinerary' and 'request' fields are required."}), 400

    user_prompt = f"""Here is the current itinerary JSON:
{json.dumps(current_itinerary)}

The user wants this change: "{change_request}"

Apply the requested change and return the FULL updated itinerary as JSON, following the exact same schema. \
Keep everything else the same unless the change logically requires updating it \
(e.g. if days are added/removed, renumber the "day" fields sequentially)."""

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]

    try:
        raw = call_ollama(messages)
        itinerary = extract_json(raw)
    except requests.exceptions.ConnectionError:
        return jsonify({"error": connection_error_message()}), 502
    except requests.exceptions.HTTPError as e:
        return jsonify({"error": http_error_message(e)}), 502
    except requests.exceptions.Timeout:
        return jsonify({"error": "The model took too long to respond."}), 504
    except ValueError as e:
        return jsonify({"error": f"Could not parse itinerary from model output: {str(e)}"}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    return jsonify({"itinerary": itinerary})


def connection_error_message():
    if OLLAMA_HOST.startswith("https://ollama.com"):
        return "Could not connect to Ollama Cloud. Check your internet connection and that OLLAMA_HOST is set to https://ollama.com."
    return "Could not connect to Ollama. Make sure Ollama is running locally ('ollama serve') and OLLAMA_HOST is correct."


def http_error_message(e):
    status = e.response.status_code if e.response is not None else None
    if status in (401, 403):
        return f"Ollama Cloud rejected the request (HTTP {status}). Check that OLLAMA_API_KEY is set correctly (create one at ollama.com/settings/keys)."
    if status == 404:
        return f"Model '{OLLAMA_MODEL}' was not found. Check the model name (see ollama.com for available cloud models)."
    if status == 429:
        return "Ollama Cloud rate limit reached. Wait a bit and try again, or check your usage at ollama.com."
    return f"Ollama returned an error (HTTP {status})."


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    debug = os.getenv("FLASK_DEBUG", "false").lower() == "true"
    app.run(host="0.0.0.0", port=port, debug=debug)
