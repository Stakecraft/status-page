FROM node:18-alpine

WORKDIR /usr/src/app

COPY backend/package.json ./
RUN npm install --omit=dev

COPY backend/ ./
COPY config/services.yaml.example ./config/services.yaml

EXPOSE 3333

CMD [ "node", "proxy-server.js" ]
