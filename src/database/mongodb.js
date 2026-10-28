import { MongoClient } from 'mongodb';
import { config } from '../config.js';

export class MongoDatabase {
  constructor(customConfig = {}) {
    this.cfg = { ...config.mongodb, ...customConfig };
    this.client = null;
    this.db = null;
  }

  async connect() {
    if (this.client) return;
    this.client = new MongoClient(this.cfg.uri, {
      connectTimeoutMS: 10000,
      serverSelectionTimeoutMS: 10000
    });
    await this.client.connect();
    this.db = this.client.db(this.cfg.database);
  }

  getCollection(name = this.cfg.collection) {
    if (!this.db) {
      throw new Error('MongoDB client não está conectado.');
    }
    return this.db.collection(name);
  }

  async *streamRawDocuments(batchSize = 500) {
    const collection = this.getCollection();
    const cursor = collection.find({}).sort({ _id: 1 }).batchSize(batchSize);

    for await (const doc of cursor) {
      yield doc;
    }
  }

  async countDocuments() {
    const collection = this.getCollection();
    return collection.countDocuments();
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
    }
  }
}
