FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y nmap wmi-client && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3001

CMD ["node", "index.js"]
