# Image de l'API pour l'hébergement (Railway, puis AWS).
# Construite depuis la RACINE du dépôt : l'image contient aussi
# database/migrations et database/seed, lus par « npm run db:setup ».
#   docker build -f apps/api/Dockerfile -t residence-api .

# --- Construction : dépendances, compilation TypeScript ---
FROM node:22-slim AS build
WORKDIR /app/apps/api
COPY apps/api/package.json apps/api/package-lock.json ./
RUN npm ci
COPY apps/api/tsconfig.json ./
COPY apps/api/src ./src
RUN npm run build && npm prune --omit=dev

# --- Exécution : seulement ce qui sert en production ---
FROM node:22-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app/apps/api
COPY --from=build /app/apps/api/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY apps/api/package.json ./
COPY apps/api/scripts/db-setup.mjs ./scripts/db-setup.mjs
COPY database/migrations /app/database/migrations
COPY database/seed /app/database/seed
USER node
EXPOSE 3000
# Étape « pre-deploy » de l'hébergeur : npm run db:setup
CMD ["node", "dist/server.js"]
