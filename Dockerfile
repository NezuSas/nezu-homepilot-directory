FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci

FROM dependencies AS build
COPY . .
RUN npm run build

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY package*.json ./
COPY --from=build /app/dist ./dist
RUN mkdir -p /var/lib/homepilot-directory
ENV DIRECTORY_DB_PATH=/var/lib/homepilot-directory/directory.db
EXPOSE 3100
CMD ["node", "dist/server.js"]
