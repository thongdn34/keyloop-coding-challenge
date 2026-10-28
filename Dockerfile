FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY . .
RUN npm run build
FROM node:22-alpine
WORKDIR /app
ARG GIT_COMMIT=unknown
ENV NODE_ENV=production PORT=3000 SERVICE_VERSION=1.0.0 GIT_COMMIT=$GIT_COMMIT
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/web/dist ./public
EXPOSE 3000
CMD ["node", "dist/main.js"]
