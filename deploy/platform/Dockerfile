FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps && npm cache clean --force
COPY --chown=node:node dist ./dist
COPY --chown=node:node launch.mjs ./launch.mjs
USER node
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "launch.mjs"]
