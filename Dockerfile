FROM node:20-slim

WORKDIR /app

RUN apt-get update && \
    apt-get install -y nmap python3 python3-pip python3-dev gcc libkrb5-dev && \
    pip3 install --break-system-packages pywinrm requests_ntlm && \
    rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3001

CMD ["node", "index.js"]
