import { validateBytes, type ValidationVerdict } from './validation.js';

/**
 * Malware scanning boundary — report §9.7 and §12.1.
 *
 * The MVP ships a structural scanner: allowlisted format, magic-byte agreement,
 * image decodability, active-content rejection, plus the EICAR test signature so
 * the pipeline is provably exercised end to end.
 *
 * This is deliberately NOT presented as antivirus. `MalwareScanner` is the seam
 * where ClamAV or a hosted scanning service is dropped in; report §12.2 lists
 * "novel malware" as the accepted residual risk for this control.
 */

export type ScanVerdict = 'CLEAN' | 'REJECTED' | 'FAILED';

export interface ScanResult {
  verdict: ScanVerdict;
  detail: string | null;
  scannerName: string;
}

export interface MalwareScanner {
  readonly name: string;
  scan(bytes: Buffer, filename: string): Promise<ScanResult>;
}

/** The standard EICAR antivirus test string, split so this file is not itself flagged. */
const EICAR = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR', '-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join(
  '',
);

export class StructuralScanner implements MalwareScanner {
  readonly name = 'extrawork-structural-v1';

  async scan(bytes: Buffer): Promise<ScanResult> {
    if (bytes.subarray(0, 128).toString('latin1').includes(EICAR)) {
      return {
        verdict: 'REJECTED',
        detail: 'EICAR test signature detected',
        scannerName: this.name,
      };
    }
    return { verdict: 'CLEAN', detail: null, scannerName: this.name };
  }
}

/**
 * Optional ClamAV driver over the clamd TCP protocol. Not enabled by default —
 * it exists so a deployment can turn on real antivirus without a code change.
 */
export class ClamAvScanner implements MalwareScanner {
  readonly name = 'clamav';

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs = 30_000,
  ) {}

  async scan(bytes: Buffer): Promise<ScanResult> {
    const net = await import('node:net');
    return new Promise<ScanResult>((resolve) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      let response = '';
      const finish = (result: ScanResult) => {
        socket.destroy();
        resolve(result);
      };

      socket.setTimeout(this.timeoutMs, () =>
        finish({ verdict: 'FAILED', detail: 'clamd timed out', scannerName: this.name }),
      );
      socket.on('error', (error) =>
        finish({ verdict: 'FAILED', detail: error.message, scannerName: this.name }),
      );
      socket.on('data', (chunk) => {
        response += chunk.toString('utf8');
      });
      socket.on('end', () => {
        if (response.includes('OK') && !response.includes('FOUND')) {
          finish({ verdict: 'CLEAN', detail: null, scannerName: this.name });
        } else if (response.includes('FOUND')) {
          finish({ verdict: 'REJECTED', detail: response.trim(), scannerName: this.name });
        } else {
          finish({
            verdict: 'FAILED',
            detail: response.trim() || 'no response',
            scannerName: this.name,
          });
        }
      });

      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        // clamd INSTREAM framing: 4-byte big-endian length, chunk, then a zero length.
        const size = Buffer.alloc(4);
        size.writeUInt32BE(bytes.length, 0);
        socket.write(size);
        socket.write(bytes);
        socket.write(Buffer.from([0, 0, 0, 0]));
      });
    });
  }
}

export interface FileProcessResult {
  validation: ValidationVerdict;
  scan: ScanResult;
  /** Sanitised, EXIF-stripped derivative for customer-facing display. */
  derivative: { bytes: Buffer; contentType: string; width: number; height: number } | null;
  imageWidth: number | null;
  imageHeight: number | null;
}

/**
 * The full quarantine pipeline: validate, scan, decode, and re-encode a display
 * derivative with EXIF (including GPS) stripped — report §9.7 requires GPS to be
 * removed from customer-visible derivatives while the original bytes are kept.
 */
export async function processUploadedFile(
  bytes: Buffer,
  declaredMimeType: string,
  declaredByteSize: number,
  scanner: MalwareScanner,
  filename: string,
): Promise<FileProcessResult> {
  const validation = validateBytes(bytes, declaredMimeType, declaredByteSize);
  if (!validation.ok) {
    return {
      validation,
      scan: { verdict: 'REJECTED', detail: validation.reason, scannerName: 'validation' },
      derivative: null,
      imageWidth: null,
      imageHeight: null,
    };
  }

  const scan = await scanner.scan(bytes, filename);
  if (scan.verdict !== 'CLEAN') {
    return { validation, scan, derivative: null, imageWidth: null, imageHeight: null };
  }

  if (!validation.detectedMimeType?.startsWith('image/')) {
    return { validation, scan, derivative: null, imageWidth: null, imageHeight: null };
  }

  try {
    const { default: sharp } = await import('sharp');
    const image = sharp(bytes, { failOn: 'error' });
    const metadata = await image.metadata();

    // Re-encoding through sharp both proves decodability and drops every
    // metadata block, GPS included, because we do not call `.withMetadata()`.
    const derivativeBytes = await sharp(bytes)
      .rotate() // apply EXIF orientation before the tag is discarded
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    const derivativeMeta = await sharp(derivativeBytes).metadata();

    return {
      validation,
      scan,
      derivative: {
        bytes: derivativeBytes,
        contentType: 'image/webp',
        width: derivativeMeta.width ?? 0,
        height: derivativeMeta.height ?? 0,
      },
      imageWidth: metadata.width ?? null,
      imageHeight: metadata.height ?? null,
    };
  } catch (error) {
    // A file that claims to be an image but cannot be decoded is rejected.
    return {
      validation,
      scan: {
        verdict: 'REJECTED',
        detail: `Image could not be decoded: ${(error as Error).message}`,
        scannerName: scan.scannerName,
      },
      derivative: null,
      imageWidth: null,
      imageHeight: null,
    };
  }
}
