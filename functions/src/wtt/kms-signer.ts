import { KeyManagementServiceClient } from '@google-cloud/kms';
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

export interface WttKmsClient {
  asymmetricSign(request: {
    name: string;
    data: Uint8Array;
    dataCrc32c: { value: number };
  }): Promise<[KmsSignatureResponse, ...unknown[]]>;
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
