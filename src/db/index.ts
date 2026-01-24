import { Database } from "bun:sqlite";
import { load } from "sqlite-vec";
import { initSchema, initVectorTable } from "./schema";

let db: Database | null = null;

export function getDb(): Database {
  if (!db) {
    db = new Database("hologram.db");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");

    // Load sqlite-vec extension
    load(db);

    // Initialize schema
    initSchema(db);
    initVectorTable(db);
  }
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
