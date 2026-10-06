import { KeyManagementServiceClient } from '@google-cloud/kms';
import { createPublicKey } from 'node:crypto';
import crc32c from 'fast-crc32c';
import { WTT_OPERATIONAL_KMS_KEY_VERSION } from './config.js';
import { WttClaimError } from './claims.js';
import type { WttKmsMessageSigner } from './solana-claims.js';

interface KmsSignatureResponse {
  name?: string | null;
  signature?: Uint8Array | string | null;
  signatureCrc32c?: { value?: number | string | { toString(): string } | null } | null;
  verifiedDataCrc32c?: boolean | null;
}

interface KmsPublicKeyResponse {
  name?: string | null;
  pem?: string | null;
  pemCrc32c?: { value?: number | string | { toString(): string } | null } | null;
}

export interface WttKmsClient {
  asymmetricSign(request: {
    name: string;
    data: Uint8Array;
    dataCrc32c: { value: number };
  }): Promise<[KmsSignatureResponse, ...unknown[]]>;
  getPublicKey?(request: { name: string }): Promise<[KmsPublicKeyResponse, ...unknown[]]>;
}

function crcValue(value: KmsSignatureResponse['signatureCrc32c']): number | null {
  if (value?.value === undefined || value.value === null) return null;
  const parsed = Number(value.value.toString());
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export class GoogleKmsWttMessageSigner implements WttKmsMessageSigner {
  constructor(
    private readonly client: WttKmsClient = new KeyManagementServiceClient(),
    private readonly keyVersionName = WTT_OPERATIONAL_KMS_KEY_VERSION,
  ) { }

  async getPublicKeyBytes(): Promise<Uint8Array> {
    if (!this.client.getPublicKey) {
      throw new WttClaimError('failed-precondition', 'Cloud KMS public-key inspection is unavailable.');
    }
    const [response] = await this.client.getPublicKey({ name: this.keyVersionName });
    if (response.name !== this.keyVersionName || !response.pem
      || crcValue(response.pemCrc32c) !== crc32c.calculate(Buffer.from(response.pem, 'utf8'))) {
      throw new WttClaimError('failed-precondition', 'Cloud KMS public-key integrity verification failed.');
    }
    const key = createPublicKey(response.pem);
    if (key.asymmetricKeyType !== 'ed25519') {
      throw new WttClaimError('failed-precondition', 'Cloud KMS public key is not Ed25519.');
    }
    const jwk = key.export({ format: 'jwk' });
    if (typeof jwk.x !== 'string') {
      throw new WttClaimError('failed-precondition', 'Cloud KMS public key is malformed.');
    }
    const bytes = Buffer.from(jwk.x, 'base64url');
    if (bytes.length !== 32) {
      throw new WttClaimError('failed-precondition', 'Cloud KMS public key is malformed.');
    }
    return new Uint8Array(bytes);
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    const exactMessage = Buffer.from(message);
    const dataChecksum = crc32c.calculate(exactMessage);
    const [response] = await this.client.asymmetricSign({
      name: this.keyVersionName,
      data: exactMessage,
      dataCrc32c: { value: dataChecksum },
    });
    if (response.name !== this.keyVersionName || response.verifiedDataCrc32c !== true) {
      throw new WttClaimError('failed-precondition', 'Cloud KMS request integrity verification failed.');
    }
    if (!response.signature) {
      throw new WttClaimError('failed-precondition', 'Cloud KMS returned no signature.');
    }
    const signature = typeof response.signature === 'string'
      ? Buffer.from(response.signature, 'base64')
      : Buffer.from(response.signature);
    if (signature.length !== 64 || crcValue(response.signatureCrc32c) !== crc32c.calculate(signature)) {
      throw new WttClaimError('failed-precondition', 'Cloud KMS signature integrity verification failed.');
    }
    return new Uint8Array(signature);
  }
}
