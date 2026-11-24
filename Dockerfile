# specify node.js image
FROM node:26-alpine

# use production node environment by default
ENV NODE_ENV=production

# set working directory.
WORKDIR /dyslinks

# download dependencies while using Docker's caching
# --ignore-scripts prevents npm ci from invoking node-gyp on better-sqlite3's
# bundled N-API prebuilds (linuxmusl-x64/arm64) and hardens the build
RUN --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,source=package-lock.json,target=package-lock.json \
    --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts

RUN mkdir -p /var/lib/dyslinks

# copy the rest of source files into the image
COPY --chown=node:node . .

RUN chown -R node:node /var/lib/dyslinks

# run as non-root user
USER node

# expose the port that the app listens on
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# initialize database and run the app (exec replaces sh so node receives SIGTERM directly)
CMD ["sh", "-c", "./node_modules/.bin/knex migrate:latest && exec node server/server.js --production"]