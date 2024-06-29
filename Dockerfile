FROM node:lts-alpine

COPY package.json /package.json

COPY package-lock.json /package-lock.json

RUN apk update

RUN npm ci --only=prod --no-optional

COPY index.js /index.js

COPY ccxt.js /ccxt.js

COPY bs.js /bs.js

COPY js /js

COPY config /config

USER node

CMD ["npm", "start"]
