/**
 * Image Storage Interface
 *
 * Handles uploading generated images to persistent storage.
 * Supports S3-compatible storage (R2, S3, MinIO) and Discord CDN.
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import type { ImageConfig } from "../config/types";
import { randomUUID } from "crypto";

// === Interfaces ===

export interface ImageStorage {
  readonly name: string;
  upload(image: Buffer, filename: string, contentType: string): Promise<string>;
}

// === S3-Compatible Storage ===

export class S3Storage implements ImageStorage {
  readonly name = "s3";
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicUrl?: string;

  constructor(options: {
    bucket: string;
    endpoint?: string;
    region?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    publicUrl?: string;
  }) {
    this.bucket = options.bucket;
    this.publicUrl = options.publicUrl;

    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region || "auto",
      credentials:
        options.accessKeyId && options.secretAccessKey
          ? {
              accessKeyId: options.accessKeyId,
              secretAccessKey: options.secretAccessKey,
            }
          : undefined,
      forcePathStyle: !!options.endpoint, // Required for R2/MinIO
    });
  }

  async upload(image: Buffer, filename: string, contentType: string): Promise<string> {
    // Generate a unique key with date prefix for organization
    const date = new Date();
    const datePrefix = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
    const uniqueId = randomUUID().slice(0, 8);
    const key = `${datePrefix}/${uniqueId}-${filename}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: image,
        ContentType: contentType,
        // Make publicly readable
        ACL: "public-read",
      })
    );

    // Return the public URL
    if (this.publicUrl) {
      return `${this.publicUrl.replace(/\/$/, "")}/${key}`;
    }

    // Fallback to constructing URL from bucket/endpoint
    const endpoint = await this.client.config.endpoint?.();
    if (endpoint) {
      return `${endpoint.protocol}//${this.bucket}.${endpoint.hostname}/${key}`;
    }

    // Default S3 URL format
    const region = await this.client.config.region?.();
    return `https://${this.bucket}.s3.${region}.amazonaws.com/${key}`;
  }
}

// === Discord CDN Storage ===

/**
 * Discord CDN storage - embeds images directly in responses.
 *
 * Unlike S3 storage, this doesn't persist images to external storage.
 * Instead, images are embedded directly in Discord messages via the
 * command/plugin response. The image data is held temporarily until
 * it can be attached to a message.
 *
 * Note: For persistent image URLs, use S3-compatible storage instead.
 */
export class DiscordStorage implements ImageStorage {
  readonly name = "discord";
  private readonly pendingImages = new Map<
    string,
    { data: Buffer; contentType: string }
  >();

  constructor() {
    // Bot instance not needed - images are embedded via response
  }

  async upload(image: Buffer, filename: string, contentType: string): Promise<string> {
    // Store the image data temporarily with a unique ID
    // The image will be attached when sending the Discord message
    const id = randomUUID();
    this.pendingImages.set(id, { data: image, contentType });

    // Return a special URL that indicates this is a pending Discord embed
    // Format: discord-pending://<id>/<filename>
    return `discord-pending://${id}/${filename}`;
  }

  /**
   * Get pending image data for embedding in a Discord message
   */
  getPending(id: string): { data: Buffer; contentType: string } | undefined {
    const image = this.pendingImages.get(id);
    if (image) {
      this.pendingImages.delete(id); // Clean up after retrieval
    }
    return image;
  }

  /**
   * Check if a URL is a pending Discord embed
   */
  static isPendingUrl(url: string): boolean {
    return url.startsWith("discord-pending://");
  }

  /**
   * Parse a pending URL to get the ID and filename
   */
  static parsePendingUrl(url: string): { id: string; filename: string } | null {
    const match = url.match(/^discord-pending:\/\/([^/]+)\/(.+)$/);
    if (!match) return null;
    return { id: match[1], filename: match[2] };
  }
}

// === In-Memory Storage (for testing) ===

export class MemoryStorage implements ImageStorage {
  readonly name = "memory";
  private readonly images = new Map<string, { data: Buffer; contentType: string }>();

  async upload(image: Buffer, filename: string, contentType: string): Promise<string> {
    const id = randomUUID();
    this.images.set(id, { data: image, contentType });
    return `memory://${id}/${filename}`;
  }

  get(id: string): { data: Buffer; contentType: string } | undefined {
    return this.images.get(id);
  }

  clear(): void {
    this.images.clear();
  }
}

// === Factory ===

export function getImageStorage(config: ImageConfig): ImageStorage {
  switch (config.storage) {
    case "s3": {
      const bucket = config.s3Bucket || process.env.S3_BUCKET;
      if (!bucket) {
        throw new Error("S3 bucket is required (config.s3Bucket or S3_BUCKET env var)");
      }

      return new S3Storage({
        bucket,
        endpoint: config.s3Endpoint || process.env.S3_ENDPOINT,
        region: config.s3Region || process.env.S3_REGION || "auto",
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        publicUrl: config.s3PublicUrl || process.env.S3_PUBLIC_URL,
      });
    }

    case "discord": {
      return new DiscordStorage();
    }

    default:
      throw new Error(`Unknown storage type: ${config.storage}`);
  }
}
