# Gunicorn loads this file automatically from the working directory, so it
# applies on Render even when the start command is just `gunicorn app:app`.
#
# Why it matters: LLM calls routinely take 30-120s. Gunicorn's default sync
# worker kills any request that runs longer than 30s, which shows up on Render
# as a random "502 / WORKER TIMEOUT". Threaded workers + a longer timeout fix it,
# and let several people generate trips at the same time.
import os

bind = f"0.0.0.0:{os.getenv('PORT', '10000')}"
worker_class = "gthread"
workers = int(os.getenv("WEB_CONCURRENCY", "2"))
threads = int(os.getenv("GUNICORN_THREADS", "8"))
timeout = 300
graceful_timeout = 30
keepalive = 5
