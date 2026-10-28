FROM node:21-alpine

WORKDIR /app

# Copia manifestos de dependências
COPY package*.json ./

# Instala apenas dependências de produção
RUN npm install --omit=dev

# Copia código-fonte
COPY . .

# Executa o pipeline contínuo
CMD ["npm", "start"]
