import { BlobServiceClient, ContainerClient, BlockBlobClient } from '@azure/storage-blob';

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
if (!connectionString) {
  throw new Error('AZURE_STORAGE_CONNECTION_STRING is not set in environment variables');
}

const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);

/**
 * Get a container client for a given container name
 */
export function getContainerClient(containerName: string): ContainerClient {
  return blobServiceClient.getContainerClient(containerName);
}

/**
 * Get a block blob client for a given container and blob name
 */
export function getBlockBlobClient(containerName: string, blobName: string): BlockBlobClient {
  return getContainerClient(containerName).getBlockBlobClient(blobName);
}

/**
 * Download a blob as a Buffer
 */
export async function downloadBlobToBuffer(containerName: string, blobName: string): Promise<Buffer> {
  const blockBlobClient = getBlockBlobClient(containerName, blobName);
  const downloadBlockBlobResponse = await blockBlobClient.download();
  return await streamToBuffer(downloadBlockBlobResponse.readableStreamBody);
}

/**
 * Upload a Buffer to a blob
 */
export async function uploadBufferToBlob(containerName: string, blobName: string, buffer: Buffer, contentType?: string): Promise<void> {
  const blockBlobClient = getBlockBlobClient(containerName, blobName);
  await blockBlobClient.uploadData(buffer, {
    blobHTTPHeaders: contentType ? { blobContentType: contentType } : undefined,
  });
}

/**
 * Helper to convert a readable stream to a Buffer
 */
async function streamToBuffer(readableStream: NodeJS.ReadableStream | null): Promise<Buffer> {
  if (!readableStream) return Buffer.alloc(0);
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    readableStream.on('data', (data) => {
      chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
    });
    readableStream.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    readableStream.on('error', reject);
  });
}
