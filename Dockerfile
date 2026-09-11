FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
RUN npm ci --workspace=@caju/api
COPY apps/api apps/api
RUN npm run build --workspace=@caju/api && npm prune --omit=dev --workspace=@caju/api

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/migrations ./apps/api/migrations
COPY --chown=node:node package.json ./package.json
USER node
EXPOSE 3001
CMD ["node", "apps/api/dist/server.js"]
