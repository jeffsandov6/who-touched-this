import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FOUNDER_MEDIA_PREFIX,
  MAX_FOUNDER_MEDIA_BYTES,
  assertAllowedPublicCanvasMediaPath,
  buildFounderMediaPath,
  formatMediaBytes,
  formatUploadProgress,
  isAllowedPublicCanvasMediaPath,
  isSupportedFounderMediaType,
  sanitizeMediaFileName,
  validateFounderMediaFile,
} from '../src/platform/media.ts';

const assetId = '123e4567-e89b-42d3-a456-426614174000';

test('filename sanitization retains safe names and normalizes presentation characters', () => {
  assert.equal(sanitizeMediaFileName(' Founder clip (final).mp4 '), 'Founder-clip-final-.mp4');
  assert.equal(sanitizeMediaFileName('still_image-01.jpg'), 'still_image-01.jpg');
});

test('filename sanitization rejects empty and traversal-capable input', () => {
  for (const name of ['', '   ', '../secret.mp4', 'folder/video.mp4', 'folder\\video.mp4', '..']) {
    assert.throws(() => sanitizeMediaFileName(name));
  }
});

test('generated paths use an opaque asset ID and remain in the exact founder namespace', () => {
  const path = buildFounderMediaPath(assetId, 'Launch clip.mp4');
  assert.equal(path, `${FOUNDER_MEDIA_PREFIX}/${assetId}/Launch-clip.mp4`);
  assert.equal(isAllowedPublicCanvasMediaPath(path), true);
});

test('path construction rejects invalid asset IDs and path traversal', () => {
  assert.throws(() => buildFounderMediaPath('founder-email', 'video.mp4'));
  assert.throws(() => buildFounderMediaPath(assetId, '../video.mp4'));
});

test('public media path validation rejects private, malformed, and nested paths', () => {
  assert.equal(isAllowedPublicCanvasMediaPath(`private/${assetId}/video.mp4`), false);
  assert.equal(isAllowedPublicCanvasMediaPath(`${FOUNDER_MEDIA_PREFIX}/${assetId}/nested/video.mp4`), false);
  assert.equal(isAllowedPublicCanvasMediaPath(`${FOUNDER_MEDIA_PREFIX}/not-a-uuid/video.mp4`), false);
});

test('download URL path guard refuses a non-public path before Firebase can initialize', () => {
  assert.throws(() => assertAllowedPublicCanvasMediaPath('private/internal/secret.mp4'));
});

test('MIME classification accepts image, audio, and video but rejects unrelated types', () => {
  for (const type of ['image/png', 'audio/mpeg', 'video/mp4']) {
    assert.equal(isSupportedFounderMediaType(type), true);
  }
  for (const type of ['text/html', 'application/javascript', 'application/octet-stream', '']) {
    assert.equal(isSupportedFounderMediaType(type), false);
  }
});

test('file validation enforces a positive finite integer size and supported MIME type', () => {
  assert.doesNotThrow(() => validateFounderMediaFile({ name: 'image.png', type: 'image/png', size: 1 }));
  assert.throws(() => validateFounderMediaFile({ name: 'empty.png', type: 'image/png', size: 0 }));
  assert.throws(() => validateFounderMediaFile({ name: 'index.html', type: 'text/html', size: 10 }));
});

test('500 MiB is accepted numerically and one byte over is rejected without a large fixture', () => {
  assert.doesNotThrow(() => validateFounderMediaFile({ name: 'long.mp4', type: 'video/mp4', size: MAX_FOUNDER_MEDIA_BYTES }));
  assert.throws(() => validateFounderMediaFile({ name: 'too-long.mp4', type: 'video/mp4', size: MAX_FOUNDER_MEDIA_BYTES + 1 }));
});

test('display helpers bound progress and format sizes', () => {
  assert.equal(formatUploadProgress(50, 100), 50);
  assert.equal(formatUploadProgress(200, 100), 100);
  assert.equal(formatUploadProgress(10, 0), 0);
  assert.equal(formatMediaBytes(1024 ** 2), '1.0 mib');
});
