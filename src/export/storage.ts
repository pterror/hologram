/**
 * Export Storage
 *
 * Handles uploading exports to S3-compatible storage.
 * Uses public URLs (bucket must be configured for public read access).
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import type { ExportConfig, ExportResult } from "./types";

export class ExportStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicUrl?: string;
  private readonly endpoint?: string;
  private readonly region: string;

  constructor(config: ExportConfig) {
    if (!config.s3Bucket) {
      throw new Error("S3 bucket is required for export storage");
    }

    this.bucket = config.s3Bucket;
    this.publicUrl = config.s3PublicUrl;
    this.endpoint = config.s3Endpoint;
    this.region = config.s3Region || "auto";

    this.client = new S3Client({
      endpoint: config.s3Endpoint,
      region: this.region,
      credentials:
        config.s3AccessKeyId && config.s3SecretAccessKey
          ? {
              accessKeyId: config.s3AccessKeyId,
              secretAccessKey: config.s3SecretAccessKey,
            }
          : undefined,
      forcePathStyle: !!config.s3Endpoint, // Required for R2/MinIO
    });
  }

  /**
   * Upload export data and return a public URL.
   */
  async upload(
    data: Buffer | string,
    filename: string,
    contentType: string
  ): Promise<ExportResult> {
    try {
      // Generate a unique key with date prefix
      const date = new Date();
      const datePrefix = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
      const uniqueId = randomUUID().slice(0, 8);
      const key = `exports/${datePrefix}/${uniqueId}-${filename}`;

      const body = typeof data === "string" ? Buffer.from(data, "utf-8") : data;

      // Upload to S3
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ContentDisposition: `attachment; filename="${filename}"`,
          ACL: "public-read",
        })
      );

      // Generate public URL
      const url = this.getPublicUrl(key);

      return {
        success: true,
        format: contentType,
        filename,
        url,
        size: body.length,
      };
    } catch (error) {
      return {
        success: false,
        format: contentType,
        filename,
        error: error instanceof Error ? error.message : "Upload failed",
      };
    }
  }

  /**
   * Get the public URL for a key.
   */
  getPublicUrl(key: string): string {
    if (this.publicUrl) {
      return `${this.publicUrl.replace(/\/$/, "")}/${key}`;
    }

    // For R2/MinIO with custom endpoint
    if (this.endpoint) {
      const url = new URL(this.endpoint);
      return `${url.protocol}//${this.bucket}.${url.hostname}/${key}`;
    }

    // Default S3 URL format
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }
}

/**
 * Get export storage instance from environment variables.
 * Returns null if not configured.
 */
export function getExportStorage(): ExportStorage | null {
  const bucket = process.env.EXPORT_S3_BUCKET;
  if (!bucket) {
    return null;
  }

  return new ExportStorage({
    s3Bucket: bucket,
    s3Endpoint: process.env.EXPORT_S3_ENDPOINT,
    s3Region: process.env.EXPORT_S3_REGION,
    s3AccessKeyId: process.env.EXPORT_S3_ACCESS_KEY_ID,
    s3SecretAccessKey: process.env.EXPORT_S3_SECRET_ACCESS_KEY,
    s3PublicUrl: process.env.EXPORT_S3_PUBLIC_URL,
    presignedUrlExpiry: process.env.EXPORT_PRESIGNED_EXPIRY
      ? parseInt(process.env.EXPORT_PRESIGNED_EXPIRY, 10)
      : 3600,
  });
}

/**
 * Format export data as a downloadable response.
 * Used when S3 is not configured - returns data for direct embedding.
 */
export function formatForDiscord(
  data: string,
  format: string
): { content: string; truncated: boolean } {
  const maxLength = 1900; // Leave room for formatting
  const codeBlockType = format === "application/json" ? "json" : "";

  if (data.length <= maxLength) {
    return {
      content: `\`\`\`${codeBlockType}\n${data}\n\`\`\``,
      truncated: false,
    };
  }

  return {
    content: `\`\`\`${codeBlockType}\n${data.slice(0, maxLength)}...\n\`\`\`\n*Output truncated. Configure S3 storage for full exports.*`,
    truncated: true,
  };
}
