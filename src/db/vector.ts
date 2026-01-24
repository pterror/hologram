import type { Database } from "bun:sqlite";

export interface VectorSearchResult {
  rowid: number;
  distance: number;
}

export class VectorDatabase {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  insert(tableName: string, rowId: number, embedding: Float32Array | number[]) {
    const stmt = this.db.prepare(
      `INSERT INTO ${tableName}(rowid, embedding) VALUES (?, ?)`
    );
    const vector =
      embedding instanceof Float32Array ? embedding : new Float32Array(embedding);
    stmt.run(rowId, vector);
  }

  insertBatch(
    tableName: string,
    items: { rowId: number; embedding: Float32Array | number[] }[]
  ) {
    const stmt = this.db.prepare(
      `INSERT INTO ${tableName}(rowid, embedding) VALUES (?, ?)`
    );
    const transaction = this.db.transaction(
      (items: { rowId: number; embedding: Float32Array | number[] }[]) => {
        for (const item of items) {
          const vector =
            item.embedding instanceof Float32Array
              ? item.embedding
              : new Float32Array(item.embedding);
          stmt.run(item.rowId, vector);
        }
      }
    );
    transaction(items);
  }

  search(
    tableName: string,
    embedding: Float32Array | number[],
    limit = 5
  ): VectorSearchResult[] {
    const vector =
      embedding instanceof Float32Array ? embedding : new Float32Array(embedding);

    const query = this.db.prepare(`
      SELECT
        rowid,
        distance
      FROM ${tableName}
      WHERE embedding MATCH ?
      ORDER BY distance
      LIMIT ${limit}
    `);

    return query.all(vector) as VectorSearchResult[];
  }

  delete(tableName: string, rowId: number) {
    const stmt = this.db.prepare(`DELETE FROM ${tableName} WHERE rowid = ?`);
    stmt.run(rowId);
  }
}
