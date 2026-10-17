# Stage 1: build frontend (Vite) + instalar todas as deps (incluindo tsx/devDeps)
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build


# Stage 2: imagem de produção (leve — sem código fonte desnecessário)
FROM node:22-alpine
WORKDIR /app

# tsx é devDependency mas necessário em runtime — copiamos node_modules completo
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Build do frontend (dist/client) e SSR (dist/server)
COPY --from=builder /app/dist ./dist

# Código TypeScript do servidor (corrido directamente por tsx)
COPY server ./server

# Ficheiros estáticos públicos servidos em /
COPY public ./public

EXPOSE 3000
ENV NODE_ENV=production PORT=3000

# Não correr como root dentro do contentor
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "--import", "tsx", "server/src/index.ts"]
