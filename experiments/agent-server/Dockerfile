ARG NODE_IMAGE=public.ecr.aws/docker/library/node@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5
FROM ${NODE_IMAGE} AS dependencies
WORKDIR /opt/agent/mastra-studio
COPY mastra-studio/package.json mastra-studio/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
FROM ${NODE_IMAGE}
ENV NODE_ENV=production NODE_OPTIONS=--max-old-space-size=512 DOON_AGENT_SYNTHETIC_ONLY=1
WORKDIR /opt/agent
COPY --from=dependencies --chown=node:node /opt/agent/mastra-studio/node_modules ./mastra-studio/node_modules
COPY --chown=node:node mastra-studio/*.mjs mastra-studio/brand.css mastra-studio/provider-status.js ./mastra-studio/
COPY --chown=node:node mastra-studio/department-registry.json mastra-studio/process-change.html mastra-studio/process-change.js mastra-studio/process-change.css ./mastra-studio/
COPY --chown=node:node mastra-studio/agent-manager.html mastra-studio/agent-manager.js mastra-studio/agent-manager-entry.js mastra-studio/agent-manager.css ./mastra-studio/
COPY --chown=node:node mastra-studio/workflow-manager.html mastra-studio/workflow-manager.js mastra-studio/workflow-manager.css ./mastra-studio/
COPY --chown=node:node mastra-studio/workflow-preview.html mastra-studio/workflow-preview.js mastra-studio/workflow-preview.css mastra-studio/workflow-schedule-form.js ./mastra-studio/
COPY --chown=node:node mastra-studio/workflow-schedules.html mastra-studio/workflow-schedules.js mastra-studio/workflow-schedules.css ./mastra-studio/
COPY --chown=node:node mastra-studio/assets/ ./mastra-studio/assets/
COPY --chown=node:node agent-server/server.mjs agent-server/http-server.mjs agent-server/session.mjs agent-server/entry.js ./agent-server/
COPY --chown=node:node agent-server/business-api.mjs agent-server/runtime-pool.mjs ./agent-server/
COPY --chown=node:node agent-server/process-change-client.mjs ./agent-server/
COPY --chown=node:node agent-server/schedule-client.mjs agent-server/schedule-worker.mjs ./agent-server/
USER node
CMD ["node","agent-server/server.mjs"]
