import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export async function sha256File(filePath) {
  return sha256(await readFile(filePath));
}

export function isPng(buffer) {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

export function pngDimensions(buffer) {
  if (!isPng(buffer) || buffer.length < 24 || buffer.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('Screenshot is not a valid PNG with an IHDR header.');
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width < 1 || height < 1) throw new Error('Screenshot PNG dimensions are invalid.');
  return { width, height };
}

export function validatePngScreenshot(buffer, config, expectedDimensions) {
  const maximumBytes = config.maximumTileBytes ?? config.maximumScreenshotBytes;
  if (buffer.length > maximumBytes) {
    throw new Error(`Screenshot PNG exceeds ${maximumBytes} bytes.`);
  }
  const dimensions = pngDimensions(buffer);
  const maximumHeight = config.tileHeight ?? config.maximumDocumentHeight;
  const maximumWidth = config.maximumTileWidth ?? Number.MAX_SAFE_INTEGER;
  const maximumPixels = config.maximumTilePixels ?? config.maximumScreenshotPixels;
  if (dimensions.height > maximumHeight || dimensions.width > maximumWidth
    || dimensions.width * dimensions.height > maximumPixels) {
    throw new Error(`Screenshot PNG exceeds archive bounds (${dimensions.width} × ${dimensions.height}).`);
  }
  if (expectedDimensions && (dimensions.width !== expectedDimensions.width
    || dimensions.height !== expectedDimensions.height)) {
    throw new Error(`Screenshot dimensions disagree: expected ${expectedDimensions.width} × ${expectedDimensions.height}, received ${dimensions.width} × ${dimensions.height}.`);
  }
  return dimensions;
}
