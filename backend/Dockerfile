# Stage 1: build the React + Vite frontend
FROM node:20-alpine AS web
WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN npm install --no-audit --no-fund
COPY frontend ./
RUN npx vite build

# Stage 2: Express API serving the built frontend
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev --no-audit --no-fund
COPY backend ./backend
COPY --from=web /src/frontend/dist ./static
ENV STATIC_DIR=/app/static INSTRUMENT_PATH=/app/backend/instrument.json PRIVACY_NOTICE_FILE=/app/backend/privacy_notice.md PORT=8000
WORKDIR /app/backend
USER node
EXPOSE 8000
CMD ["node", "src/server.js"]
