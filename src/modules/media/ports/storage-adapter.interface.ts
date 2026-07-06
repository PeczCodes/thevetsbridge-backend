export interface SignatureResponse {
  signature: string;
  timestamp: number;
  apiKey: string;
  cloudName: string;
  publicId: string;
  folder: string;
}

export interface AssetMetadata {
  secureUrl: string;
  bytes: number;
  format: string;
  width?: number;
  height?: number;
  duration?: number;
  etag?: string;
  version?: string;
}

export interface StorageAdapter {
  generateUploadSignature(
    publicId: string,
    folder: string,
    context: Record<string, string>,
  ): Promise<SignatureResponse>;

  getAssetMetadata(publicId: string): Promise<AssetMetadata>;

  deleteAsset(publicId: string): Promise<void>;
}

export const STORAGE_ADAPTER = 'STORAGE_ADAPTER';
