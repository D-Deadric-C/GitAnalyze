# Python RAG service for Cloud Run.
#
# Build from the repository root, since pyproject.toml lives there:
#   docker build -f rag_service/Dockerfile -t gitpulse-rag .
#   docker run -p 8008:8080 -e GEMINI_API_KEY=... -e GITHUB_TOKEN=... gitpulse-rag

FROM python:3.13-slim AS runner
WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

COPY pyproject.toml ./
COPY rag_service ./rag_service

# Installs the runtime dependencies declared in pyproject.toml (without the
# optional test extra).
RUN pip install --no-cache-dir .

RUN useradd --system --uid 1001 raguser
USER raguser

# Cloud Run injects PORT; default to 8080 to match its convention.
ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "uvicorn gitpulse_rag.app:app --app-dir rag_service --host 0.0.0.0 --port ${PORT}"]
