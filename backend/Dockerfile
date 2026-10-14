FROM node:24-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DATABASE_PATH=/app/data/firewall.sqlite
WORKDIR /app
RUN mkdir data && chown node:node data
COPY --chown=node:node backend/server.mjs ./server.mjs
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
