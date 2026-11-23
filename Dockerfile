FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --chown=node:node dist/ dist/
COPY --chown=node:node server/ server/
RUN mkdir -p /data && chown node:node /data
USER node
ENV TRACEX_HOST=0.0.0.0 TRACEX_PORT=4318 TRACEX_DB=/data/team.sqlite
EXPOSE 4318
CMD ["node","server/start.mjs"]
