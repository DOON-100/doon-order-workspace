ARG NODE_IMAGE=public.ecr.aws/docker/library/node@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5
FROM ${NODE_IMAGE} AS dependencies
WORKDIR /opt/agent/cloud-agent
COPY cloud-agent/package.json cloud-agent/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
FROM ${NODE_IMAGE}
ENV NODE_ENV=production SYNTHETIC_ONLY=1 NODE_OPTIONS=--max-old-space-size=384
WORKDIR /opt/agent/cloud-agent
COPY --from=dependencies --chown=node:node /opt/agent/cloud-agent/node_modules ./node_modules
COPY --chown=node:node cloud-agent/*.mjs cloud-agent/package.json ./
COPY --chown=node:node mastra-studio/offline-model.mjs ../mastra-studio/offline-model.mjs
USER node
EXPOSE 8798
CMD ["node","server.mjs"]
