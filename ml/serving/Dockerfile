# CPU-only image for the YINGLONG ML signal service (fits a 2 vCPU / 8 GiB VM).
# Build from ml/serving:  docker build -t yinglong-ml .
# Models are fetched at build time from the pinned revisions in models.lock.json (HF_TOKEN needed for private repos):
#   docker build --secret id=hf_token,env=HF_TOKEN -t yinglong-ml .
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_LINK_MODE=copy YL_ORT_THREADS=2
RUN pip install --no-cache-dir uv==0.12.19 && apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY pyproject.toml ./
RUN uv sync --no-dev
COPY app.py fetch_models.py models.lock.json ./
RUN --mount=type=secret,id=hf_token HF_TOKEN=$(cat /run/secrets/hf_token 2>/dev/null || true) uv run python fetch_models.py
EXPOSE 8090
USER nobody
CMD ["uv", "run", "--no-sync", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8090", "--workers", "1"]
