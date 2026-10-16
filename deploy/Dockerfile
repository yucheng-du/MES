FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
RUN npm run build

FROM node:22-bookworm-slim AS api
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4300
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /var/lib/mes/uploads && chown node:node /var/lib/mes/uploads
USER node
EXPOSE 4300
CMD ["npm", "run", "start", "-w", "@mes/api"]

FROM caddy:2-alpine AS web
COPY --from=build /app/apps/web/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
EXPOSE 80 443
