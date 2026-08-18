/**
 * The certificate that makes an electronic record admissible in an Indian court.
 *
 * Section 63 of the **Bharatiya Sakshya Adhiniyam, 2023** replaced section 65B
 * of the Indian Evidence Act, 1872 with effect from 1 July 2024. It is the
 * provision under which a printout or copy of an electronic record is received
 * in evidence *without producing the original device* — and it is conditional:
 * the record must be accompanied by a certificate.
 *
 * This is the single highest-value legal artefact this product can generate,
 * and it is worth being precise about why. It does **not** make the underlying
 * agreement binding — the Indian Contract Act, 1872 does that, and section 10A
 * of the IT Act, 2000 confirms a contract is not void merely for being
 * electronic. What section 63 governs is whether a judge may *look at* the
 * record at all. An unimpeachable agreement that cannot be admitted is worth
 * nothing in the dispute it was created for.
 *
 * What section 63 requires, and how this module maps onto it:
 *
 *   - identification of the electronic record and how it was produced
 *       → `record`, `producedBy`
 *   - particulars of the device/system, and that it was in regular use and in
 *     the lawful control of the person using it
 *       → `system`, `regularUse`, `lawfulControl`
 *   - **the hash value of the record** — new in the 2023 Act and absent from
 *     the old section 65B
 *       → `record.sha256`, taken from the frozen canonical snapshot that has
 *         existed in this system since long before this module
 *   - signature of the **person in charge** of the device AND of an **expert**
 *       → `attestations`, deliberately left UNSIGNED
 *
 * That last point is why this builder produces a certificate that is complete
 * in every respect except its signatures. Section 63 wants two human beings to
 * put their names to it, and a system that pre-filled them would be forging the
 * very attestation the section exists to obtain. The generated document carries
 * the blocks, the facts each attestor is certifying, and space to sign.
 *
 * None of this is legal advice, and none of it should be represented as
 * counsel's opinion. It is an engineering artefact built to a public statute so
 * that a lawyer has something to work with instead of a database.
 */

export const SECTION_63_SCHEMA_VERSION = 1;

/** The statute this certificate is drawn under. */
export const SECTION_63_AUTHORITY =
  'Section 63, Bharatiya Sakshya Adhiniyam, 2023 (in force from 1 July 2024; ' +
  'successor to section 65B, Indian Evidence Act, 1872)';

export interface Section63Input {
  /** What the record is, in plain words a non-technical reader can check. */
  recordDescription: string;
  /** Hex SHA-256 of the canonical record. */
  recordSha256: string;
  /** Hex SHA-256 of the manifest describing it. */
  manifestSha256: string;
  /** Terminal hash of the aggregate's append-only audit chain. */
  terminalEventHash: string;
  /** Whether the chain recomputed cleanly at generation time. */
  chainVerified: boolean;
  generatedAt: string;
  generatorVersion: string;
  organizationLegalName: string;
  organizationDisplayName: string;
}

export interface Section63Certificate {
  schemaVersion: number;
  authority: string;
  /** Paragraph-by-paragraph statements the certificate makes. */
  statements: string[];
  record: {
    description: string;
    sha256: string;
    manifestSha256: string;
    terminalEventHash: string;
    hashAlgorithm: 'SHA-256';
    integrityVerifiedAtGeneration: boolean;
  };
  /** Signature blocks, intentionally unsigned. */
  attestations: Array<{ role: string; certifying: string; name: null; signedOn: null }>;
  /** What this certificate does NOT establish. Never omit. */
  limitations: string[];
}

export function buildSection63Certificate(input: Section63Input): Section63Certificate {
  const holder = input.organizationLegalName || input.organizationDisplayName;

  return {
    schemaVersion: SECTION_63_SCHEMA_VERSION,
    authority: SECTION_63_AUTHORITY,
    statements: [
      `The electronic record described below was produced by a computer system operated by ${holder} in the ordinary course of its business.`,
      'Throughout the material period the system was in regular use to create, store and process information of this kind.',
      'The system was operating properly at the material time. Where it was not, that did not affect the accuracy or content of this record.',
      'The information in this record is derived from information supplied to the system in the ordinary course of that activity.',
      `The hash value of the record is stated below and was computed using SHA-256 over the canonical form of the record, which was frozen at the time the request was sent and has not been rewritten since.`,
    ],
    record: {
      description: input.recordDescription,
      sha256: input.recordSha256,
      manifestSha256: input.manifestSha256,
      terminalEventHash: input.terminalEventHash,
      hashAlgorithm: 'SHA-256',
      integrityVerifiedAtGeneration: input.chainVerified,
    },
    attestations: [
      {
        role: 'Person in charge of the computer or communication device',
        certifying:
          'that the statements above are true of the system under their control, and that the hash value stated is that of the record produced.',
        name: null,
        signedOn: null,
      },
      {
        role: 'Expert',
        certifying:
          'that the record and its stated hash value correspond, and that the record bears no sign of alteration since the hash was computed.',
        name: null,
        signedOn: null,
      },
    ],
    limitations: [
      'This certificate concerns the admissibility of an electronic record. It does not by itself establish that the underlying agreement is enforceable, nor what it means.',
      'It is unsigned as generated. Section 63 requires the signature of the person in charge of the device and of an expert; a certificate that filled those in automatically would be worthless.',
      'It makes no statement about the identity of the person who signed the agreement. Attribution rests on the evidence recorded elsewhere in this pack.',
      'Any stamp duty payable on the underlying instrument is unaffected by this certificate and remains the parties’ responsibility.',
    ],
  };
}
