# CPU-only image for the YINGLONG ML signal service (fits a 2 vCPU / 8 GiB VM).
# Build from ml/serving:  docker build -t yinglong-ml .
# The image holds NO model weights and NO token. At container start, entrypoint.sh runs fetch_models.py, which downloads
# the files pinned in models.lock.json (revision and SHA-256, verified; a mismatch stops the container) into /models
# (mount a named volume there). Private repos need a READ token: mount a file and set HF_TOKEN_FILE (or set HF_TOKEN).
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_LINK_MODE=copy YL_ORT_THREADS=2 \
    PATH=/srv/.venv/bin:$PATH YL_MODELS_DIR=/models HOME=/tmp HF_HOME=/tmp/hf
RUN pip install --no-cache-dir uv==0.12.19 && apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY app.py fetch_models.py models.lock.json entrypoint.sh ./
# Owned by uid 1000 so a fresh named volume mounted at /models is writable by the service user.
RUN chmod 755 /srv/entrypoint.sh && mkdir /models && chown 1000:1000 /models
EXPOSE 8090
USER 1000:1000
ENTRYPOINT ["/srv/entrypoint.sh"]
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8090", "--workers", "1"]
