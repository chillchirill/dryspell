FROM node:24-bookworm-slim AS node
FROM python:3.12-slim-bookworm
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && apt-get update && apt-get install -y --no-install-recommends libstdc++6 libgomp1 libatomic1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 NODE_ENV=production \
    OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MPLCONFIGDIR=/tmp/matplotlib
COPY deploy/requirements.txt deploy/requirements.txt
RUN pip install --no-cache-dir -r deploy/requirements.txt
COPY deploy/package.json deploy/package-lock.json deploy/
RUN npm ci --prefix deploy --omit=dev --ignore-scripts
RUN node --version && python -c "import numpy, pandas, scipy, sklearn, eccodes"
COPY . .
RUN useradd --uid 10001 --create-home app && chown -R app:app /app
USER app
EXPOSE 10000
CMD ["node", "deploy/gateway.mjs"]
