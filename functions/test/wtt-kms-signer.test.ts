import assert from 'node:assert/strict';
import test from 'node:test';
import crc32c from 'fast-crc32c';
import { GoogleKmsWttMessageSigner, type WttKmsClient } from '../src/wtt/kms-signer.js';
import { WTT_OPERATIONAL_KMS_KEY_VERSION } from '../src/wtt/config.js';

function clientFor(response: Record<string, unknown>, inspect?: (request: Record<string, unknown>) => void): WttKmsClient {
  return {
    async asymmetricSign(request) {
      inspect?.(request);
      return [response];
    },
  } as WttKmsClient;
}

test('KMS receives exact serialized message bytes with request and response integrity checks', async () => {
  const message = new TextEncoder().encode('exact Solana transaction message');
  const signature = Buffer.alloc(64, 7);
  let inspected = false;
  const signer = new GoogleKmsWttMessageSigner(clientFor({
    name: WTT_OPERATIONAL_KMS_KEY_VERSION,
    verifiedDataCrc32c: true,
    signature,
    signatureCrc32c: { value: crc32c.calculate(signature) },
  }, (request) => {
    inspected = true;
    assert.equal(request.name, WTT_OPERATIONAL_KMS_KEY_VERSION);
    assert.deepEqual(request.data, Buffer.from(message));
    assert.deepEqual(request.dataCrc32c, { value: crc32c.calculate(Buffer.from(message)) });
    assert.equal('digest' in request, false, 'Ed25519 uses raw data, not a pre-hashed digest');
  }));
  assert.deepEqual(await signer.signMessage(message), new Uint8Array(signature));
  assert.equal(inspected, true);
});

test('KMS malformed signature and integrity failures are rejected', async () => {
  const message = new Uint8Array([1, 2, 3]);
  const validSignature = Buffer.alloc(64, 9);
  for (const response of [
    {
      name: 'wrong-key-version', verifiedDataCrc32c: true, signature: validSignature,
      signatureCrc32c: { value: crc32c.calculate(validSignature) },
    },
    {
      name: WTT_OPERATIONAL_KMS_KEY_VERSION, verifiedDataCrc32c: false, signature: validSignature,
      signatureCrc32c: { value: crc32c.calculate(validSignature) },
    },
    {
      name: WTT_OPERATIONAL_KMS_KEY_VERSION, verifiedDataCrc32c: true,
      signature: Buffer.alloc(63), signatureCrc32c: { value: crc32c.calculate(Buffer.alloc(63)) },
    },
    {
      name: WTT_OPERATIONAL_KMS_KEY_VERSION, verifiedDataCrc32c: true,
      signature: validSignature, signatureCrc32c: { value: 1 },
    },
  ]) {
    await assert.rejects(
      new GoogleKmsWttMessageSigner(clientFor(response)).signMessage(message),
      /integrity|no signature/,
    );
  }
});

test('production signer source contains no local private-key fallback', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) => readFile(
    new URL('../../src/wtt/kms-signer.ts', import.meta.url), 'utf8',
  ));
  assert.doesNotMatch(source, /Keypair|secretKey|seed phrase|private key/i);
  assert.match(source, /asymmetricSign/);
});

test('only the claim callable receives the KMS-capable runtime identity', async () => {
  const { readFile } = await import('node:fs/promises');
  const indexSource = await readFile(new URL('../../src/index.ts', import.meta.url), 'utf8');
  const configSource = await readFile(new URL('../../src/wtt/config.ts', import.meta.url), 'utf8');
  assert.equal((indexSource.match(/serviceAccount: WTT_CLAIM_SERVICE_ACCOUNT/g) ?? []).length, 1);
  assert.match(indexSource, /export const claimWtt = onCall\(\{[\s\S]*?serviceAccount: WTT_CLAIM_SERVICE_ACCOUNT/);
  assert.doesNotMatch(indexSource.match(/export const issueWttClaimChallenge[\s\S]*?\n\}\);/)?.[0] ?? '', /serviceAccount/);
  assert.doesNotMatch(indexSource.match(/export const verifyWttClaimChallenge[\s\S]*?\n\}\);/)?.[0] ?? '', /serviceAccount/);
  assert.match(configSource, /wtt-operational-mainnet\/cryptoKeyVersions\/1/);
  assert.doesNotMatch(configSource, /wtt-metadata-mainnet/);
});
