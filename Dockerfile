FROM node:20-alpine
WORKDIR /app

# Copia só os arquivos de dependências primeiro: o Docker reaproveita essa camada
# enquanto o package.json não mudar (builds muito mais rápidos).
COPY package*.json ./
RUN npm install

COPY . .
EXPOSE 3000

# --watch reinicia a API sozinha quando você salva um arquivo
CMD ["node", "--watch", "src/server.js"]
