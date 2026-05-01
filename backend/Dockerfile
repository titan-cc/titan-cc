FROM python:3.12-slim

WORKDIR /app

RUN pip install uv --no-cache-dir

COPY pyproject.toml ./
RUN uv pip install --system --no-cache .

COPY . .

ENV PYTHONUNBUFFERED=1

EXPOSE 8000

# Run migrations then start the server. On a fresh Railway Postgres the tables
# won't exist yet; alembic upgrade head is idempotent so safe on every restart.
CMD ["sh", "-c", "set -e; echo '[startup] running alembic upgrade head'; alembic upgrade head; echo '[startup] alembic done, starting uvicorn'; exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
