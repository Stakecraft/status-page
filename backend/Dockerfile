FROM node:18-alpine AS builder

WORKDIR /usr/src/app

# Install dependencies
COPY package.json ./
# If you have a package-lock.json, it's good practice to copy and use it too
# COPY package-lock.json ./
RUN npm install --omit=dev

# Bundle app source
COPY . .

# Expose the port the app runs on
# This should match PROXY_SERVER_PORT in your proxy-server.js (default 3000)
EXPOSE 3000

CMD [ "node", "proxy-server.js" ] 