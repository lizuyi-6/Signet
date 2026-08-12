/**
 * @signet/gen-fixtures — build-time fixture generator.
 *
 * Emits the PNG fixtures the demo and extension read at runtime:
 *
 *   verified.png     — C2PA-signed, clean (→ TrustState `verified`)
 *   verified-ai.png  — C2PA-signed with an AI declaration (→ `verified-ai`)
 *   unknown.png      — unsigned PNG, no manifest (→ `unknown/no-evidence`)
 *   tampered.png     — copy of verified.png with one image byte flipped
 *                      (→ `broken/integrity-mismatch`)
 *
 * RELIABILITY CONTRACT — this script never just "writes files". After emitting
 * each fixture it reads the bytes back through the SAME read path the runtime
 * uses (@signet/evidence readC2paEvidence → @signet/trust-engine
 * decide) and asserts the resulting TrustState equals the intended one. If any
 * fixture fails this check the script exits non-zero, so a stale/wrong fixture
 * can never silently reach the demo. See docs/decisions.md D11/D12/D14.
 *
 * Run: `pnpm gen:fixtures` (see root package.json). Requires network for the
 * RFC-3161 TSA used at signing time (D13); the generated PNGs are committed so
 * the runtime needs no network.
 */
/* eslint-disable no-console -- this is a CLI tool; printing the self-verification
   result table to stdout is its entire user-facing output. */
import { createC2pa, ManifestBuilder, createTestSigner } from 'c2pa-node';
import { deflateSync, crc32 } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { readC2paEvidence } from '@signet/evidence';
import { decide } from '@signet/trust-engine';
import type { TrustState } from '@signet/core';

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(here, '../../../apps/demo/public/fixtures');

// ---------------------------------------------------------------------------
// Minimal pure-Node PNG encoder (RGB, 8-bit). Avoids a native image dep.
// ---------------------------------------------------------------------------
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

export function encodePng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number],
): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
    }
  }
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Tamper: flip one byte inside the FIRST IDAT chunk (the hashed image data).
//
// The earlier "flip the file midpoint" heuristic was disproved by self-
// verification: for some signed-file layouts the midpoint lands outside the
// hashed region and the tamper reads back clean (verified) — a silent failure.
// Parsing PNG chunks and flipping a byte *inside IDAT*, then recomputing that
// chunk's CRC, guarantees: (a) the PNG stays structurally valid, (b) the
// decompressed pixels differ from what C2PA hashed, so the reader always
// reports assertion.dataHash.mismatch. See docs/decisions.md D14.
// ---------------------------------------------------------------------------
interface PngChunk {
  readonly type: string;
  readonly data: Buffer;
}

function parsePngChunks(buf: Buffer): PngChunk[] {
  // 8-byte signature, then [4 len][4 type][len data][4 crc] chunks.
  const chunks: PngChunk[] = [];
  let p = 8;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    chunks.push({ type, data });
    p += 12 + len;
    if (type === 'IEND') {
      break;
    }
  }
  return chunks;
}

export function tamperInsideIdat(buf: Buffer): Buffer {
  const chunks = parsePngChunks(buf);
  const idatIdx = chunks.findIndex((c) => c.type === 'IDAT');
  // Narrow through a named binding so noUncheckedIndexedAccess is satisfied:
  // after this guard `idat` is a definite PngChunk.
  const idat = idatIdx >= 0 ? chunks[idatIdx] : undefined;
  if (!idat || idat.data.length < 4) {
    throw new Error('no IDAT chunk available to tamper');
  }
  // Flip a byte in the middle of the IDAT payload (avoid the very first byte,
  // which is the per-row filter selector and can corrupt structure).
  const data = Buffer.from(idat.data);
  const at = Math.floor(data.length / 2);
  data[at] = (data[at] ?? 0) ^ 0xff;

  // Re-emit the file with the modified IDAT and a recomputed IDAT CRC, so the
  // PNG is structurally valid and only the pixel content changed.
  const sig = buf.subarray(0, 8);
  const out: Buffer[] = [Buffer.from(sig)];
  for (const chunk of chunks) {
    const cd = chunk === idat ? data : chunk.data;
    const header = Buffer.alloc(8);
    header.writeUInt32BE(cd.length, 0);
    header.write(chunk.type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(chunk.type, 'ascii'), cd])), 0);
    out.push(header, cd, crc);
  }
  return Buffer.concat(out);
}

interface ExpectedFixture {
  readonly name: string;
  readonly bytes: Buffer;
  readonly expectState: TrustState;
  readonly expectReason?: string;
}

async function verifyFixture(
  fx: ExpectedFixture,
  results: { name: string; ok: boolean; detail: string }[],
): Promise<void> {
  const graph = await readC2paEvidence(fx.bytes, 'image/png', fx.name);
  const decision = decide(graph);
  const stateOk = decision.state === fx.expectState;
  const reasonOk = fx.expectReason ? decision.reason === fx.expectReason : true;
  const ok = stateOk && reasonOk;
  const itemStatuses = graph.items.map((i) => `${i.type}:${i.status}`).join(' ');
  results.push({
    name: fx.name,
    ok,
    detail: `state=${decision.state} reason=${decision.reason} (expected ${fx.expectState}${
      fx.expectReason ? `/${fx.expectReason}` : ''
    }) [${itemStatuses || 'no-items'}]${
      graph.verificationError ? ` verificationError: ${graph.errorMessage ?? ''}` : ''
    }`,
  });
  await writeFile(resolve(OUT_DIR, fx.name), fx.bytes);
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  // Sign-capable instance. Per D13 the 0.5.26 binary requires tsaUrl, which
  // createTestSigner supplies (digicert RFC-3161). Read-only checks below use
  // a separate no-signer instance via readC2paEvidence.
  const signer = await createTestSigner();
  const c2pa = await createC2pa({ signer });

  const W = 320;
  const H = 200;

  // A distinguishable base image per fixture (simple gradients — the demo in
  // Phase 4 will render richer visuals; Phase 2 only needs signed bytes).
  const basePixels =
    (hue: 'blue' | 'amber' | 'green') =>
    (x: number, y: number): [number, number, number] => {
      const u = x / W;
      const v = y / H;
      if (hue === 'blue') return [Math.round(40 + 60 * u), Math.round(80 + 60 * v), 200];
      if (hue === 'amber') return [220, Math.round(140 + 60 * u), Math.round(40 + 60 * v)];
      return [Math.round(40 + 60 * u), 170, Math.round(90 + 50 * v)];
    };

  // --- verified.png: real photo, captured ---
  const verifiedPng = encodePng(W, H, basePixels('blue'));
  const verifiedSigned = (
    await c2pa.sign({
      manifest: new ManifestBuilder({
        claim_generator: 'Signet/0.1',
        format: 'image/png',
        title: 'Q3 site incident — verified photograph',
        assertions: [
          {
            label: 'c2pa.actions',
            data: {
              actions: [{ action: 'c2pa.captured', when: '2026-07-15T09:30:00Z' }],
            },
          },
        ],
      }),
      asset: { buffer: verifiedPng, mimeType: 'image/png' },
    })
  ).signedAsset.buffer;

  // --- verified-ai.png: AI-generated figure with a clean AI declaration ---
  const verifiedAiPng = encodePng(W, H, basePixels('amber'));
  const verifiedAiSigned = (
    await c2pa.sign({
      manifest: new ManifestBuilder({
        claim_generator: 'Signet/0.1',
        format: 'image/png',
        title: 'Forecast chart — AI generated',
        assertions: [
          {
            label: 'c2pa.ai.gen',
            data: {
              generator: { description: 'Signet Demo Diffusion', type: 'software' },
              digitalSourceType: 'trainedAlgorithmicMedia',
            },
          },
          {
            label: 'c2pa.actions',
            data: {
              actions: [{ action: 'c2pa.placed', when: '2026-07-15T10:00:00Z' }],
            },
          },
        ],
      }),
      asset: { buffer: verifiedAiPng, mimeType: 'image/png' },
    })
  ).signedAsset.buffer;

  // --- unknown.png: unsigned (no manifest) ---
  const unknownPng = encodePng(W, H, basePixels('green'));

  // --- tampered.png: verified.png with an IDAT byte flipped ---
  const tamperedPng = tamperInsideIdat(verifiedSigned);

  const fixtures: ExpectedFixture[] = [
    {
      name: 'verified.png',
      bytes: verifiedSigned,
      expectState: 'verified',
      expectReason: 'valid-credential',
    },
    {
      name: 'verified-ai.png',
      bytes: verifiedAiSigned,
      expectState: 'verified-ai',
      expectReason: 'ai-declared-and-valid',
    },
    { name: 'unknown.png', bytes: unknownPng, expectState: 'unknown', expectReason: 'no-evidence' },
    {
      name: 'tampered.png',
      bytes: tamperedPng,
      expectState: 'broken',
      expectReason: 'integrity-mismatch',
    },
  ];

  const results: { name: string; ok: boolean; detail: string }[] = [];
  for (const fx of fixtures) {
    await verifyFixture(fx, results);
  }

  console.log('\n=== fixture self-verification ===');
  for (const r of results) {
    console.log(`  ${r.ok ? 'OK   ' : 'FAIL '} ${r.name.padEnd(16)} ${r.detail}`);
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(
      `\n${failed.length} fixture(s) failed self-verification; aborting (no stale fixtures committed).`,
    );
    process.exit(1);
  }
  console.log(`\nall ${results.length} fixtures verified and written to ${OUT_DIR}`);
}

// Only run the signing/main flow when this file is the process entry point
// (e.g. `tsx tools/gen-fixtures/src/index.ts`). When imported — by the unit
// tests below or anything else — main() is NOT invoked, so importing this
// module never triggers the network signing path or any filesystem writes.
const isMainEntry =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMainEntry) {
  main().catch((e) => {
    console.error('fixture generation failed:', e?.stack || e);
    process.exit(1);
  });
}
