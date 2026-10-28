import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

// Carrega variáveis de ambiente padrão se existirem
dotenv.config();

function parseCustomEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const parsed = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Se estiver no formato KEY=VALUE
    if (trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
      parsed[key] = val;
      continue;
    }

    // Se estiver no formato tabular delimitado por tab/múltiplos espaços
    const parts = trimmed.split(/\t+|\s{2,}/).map(p => p.trim());
    if (parts.length >= 4) {
      const servico = parts[0].toLowerCase();
      const endpoint = parts[1];
      const usuarioRaw = parts[2];
      const senha = parts[3];

      let host = endpoint;
      let port = '';
      if (endpoint.includes(':')) {
        const [h, p] = endpoint.split(':');
        host = h.trim();
        port = p.split(' ')[0].trim();
      }

      if (servico.includes('mariadb')) {
        parsed.MARIADB_HOST = parsed.MARIADB_HOST || host;
        parsed.MARIADB_PORT = parsed.MARIADB_PORT || port || '3306';
        parsed.MARIADB_USER = parsed.MARIADB_USER || (usuarioRaw.includes(' ') ? usuarioRaw.split(' ')[0] : usuarioRaw);
        parsed.MARIADB_DATABASE = parsed.MARIADB_DATABASE || 'fatec_iot';
        parsed.MARIADB_PASSWORD = parsed.MARIADB_PASSWORD || senha;
      } else if (servico.includes('mongodb')) {
        parsed.MONGODB_HOST = parsed.MONGODB_HOST || host;
        parsed.MONGODB_PORT = parsed.MONGODB_PORT || port || '27017';
        parsed.MONGODB_USER = parsed.MONGODB_USER || usuarioRaw;
        parsed.MONGODB_PASSWORD = parsed.MONGODB_PASSWORD || senha;
        parsed.MONGODB_DATABASE = parsed.MONGODB_DATABASE || 'iot';
        parsed.MONGODB_AUTH_SOURCE = parsed.MONGODB_AUTH_SOURCE || 'admin';
      } else if (servico.includes('redis')) {
        parsed.REDIS_HOST = parsed.REDIS_HOST || host;
        parsed.REDIS_PORT = parsed.REDIS_PORT || port || '6379';
        parsed.REDIS_PASSWORD = parsed.REDIS_PASSWORD || senha;
      }
    }
  }

  return parsed;
}

const envPath = path.resolve(process.cwd(), '.env');
const fileConfig = parseCustomEnv(envPath);

export const config = {
  mongodb: {
    host: process.env.MONGODB_HOST || fileConfig.MONGODB_HOST || 'localhost',
    port: parseInt(process.env.MONGODB_PORT || fileConfig.MONGODB_PORT || '27017', 10),
    user: process.env.MONGODB_USER || fileConfig.MONGODB_USER || '',
    password: process.env.MONGODB_PASSWORD || fileConfig.MONGODB_PASSWORD || '',
    database: process.env.MONGODB_DATABASE || fileConfig.MONGODB_DATABASE || 'iot',
    authSource: process.env.MONGODB_AUTH_SOURCE || fileConfig.MONGODB_AUTH_SOURCE || 'admin',
    collection: process.env.MONGODB_COLLECTION || 'sensores',
    get uri() {
      if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
      if (this.user && this.password) {
        return `mongodb://${encodeURIComponent(this.user)}:${encodeURIComponent(this.password)}@${this.host}:${this.port}/${this.database}?authSource=${this.authSource}`;
      }
      return `mongodb://${this.host}:${this.port}/${this.database}`;
    }
  },
  mariadb: {
    host: process.env.MARIADB_HOST || fileConfig.MARIADB_HOST || 'localhost',
    port: parseInt(process.env.MARIADB_PORT || fileConfig.MARIADB_PORT || '3306', 10),
    user: process.env.MARIADB_USER || fileConfig.MARIADB_USER || 'root',
    password: process.env.MARIADB_PASSWORD || fileConfig.MARIADB_PASSWORD || '',
    database: process.env.MARIADB_DATABASE || fileConfig.MARIADB_DATABASE || 'fatec_iot',
    prefix: process.env.TABLE_PREFIX || 'eduardo_'
  },
  redis: {
    host: process.env.REDIS_HOST || fileConfig.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || fileConfig.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || fileConfig.REDIS_PASSWORD || undefined,
    prefix: process.env.REDIS_PREFIX || 'eduardo:'
  }
};
