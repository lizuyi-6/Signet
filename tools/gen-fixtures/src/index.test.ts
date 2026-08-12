/**
 * @signet/gen-fixtures — unit tests for the pure PNG helpers.
 *
 * These lock the deterministic behaviour of the encoder and the chunk-aware
 * tamper *without* needing the c2pa-node native binary or network. The full
 * sign→read→tamper→read loop is exercised by the generator's own
 * self-verification pass (`pnpm gen:fixtures`), which exits non-zero if any
 * fixture reads back to the wrong trust state.
 */
import { describe, expect, it } from 'vitest';
import { crc32 } from 'node:zlib';

import { encodePng, tamperInsideIdat } from './index.js';

describe('encodePng', () => {
  it('emits a valid PNG signature and is round-trippable through chunk parsing', () => {
    const png = encodePng(4, 3, () => [10, 20, 30]);
    // PNG signature.
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    // IHDR chunk declares 4×3, bit depth 8, colour type 2 (RGB).
    expect(png.readUInt32BE(8)).toBe(13); // IHDR length
    expect(png.toString('ascii', 12, 16)).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(4);
    expect(png.readUInt32BE(20)).toBe(3);
    // Last 8 bytes are the IEND chunk (length 0 + type + crc).
    expect(png.toString('ascii', png.length - 8, png.length - 4)).toBe('IEND');
  });
});

describe('tamperInsideIdat', () => {
  it('flips exactly one IDAT data byte, recomputes only that CRC, and preserves structure', () => {
    const original = encodePng(16, 16, (x, y) => [x * 10, y * 10, 100]);
    const tampered = tamperInsideIdat(original);

    // Walk both files chunk-by-chunk and compare structurally.
    const walk = (buf: Buffer) => {
      const out: { type: string; data: Buffer; crc: Buffer }[] = [];
      let p = 8;
      while (p < buf.length) {
        const len = buf.readUInt32BE(p);
        const type = buf.toString('ascii', p + 4, p + 8);
        const data = Buffer.from(buf.subarray(p + 8, p + 8 + len));
        const crc = Buffer.from(buf.subarray(p + 8 + len, p + 12 + len));
        out.push({ type, data, crc });
        p += 12 + len;
        if (type === 'IEND') break;
      }
      return out;
    };
    const a = walk(original);
    const b = walk(tampered);

    // Same chunk count and identical chunk types/lengths (structure preserved).
    expect(b.length).toBe(a.length);
    for (let i = 0; i < a.length; i++) {
      expect(b[i]!.type).toBe(a[i]!.type);
      expect(b[i]!.data.length).toBe(a[i]!.data.length);
    }

    // For every chunk that is NOT IDAT, the bytes must be byte-identical
    // (data AND crc). Only the IDAT chunk is allowed to differ.
    let idatDataDiffs = 0;
    let nonIdatDiffs = 0;
    for (let i = 0; i < a.length; i++) {
      const isIdat = a[i]!.type === 'IDAT';
      for (let j = 0; j < a[i]!.data.length; j++) {
        if (a[i]!.data[j] !== b[i]!.data[j]) {
          if (isIdat) idatDataDiffs++;
          else nonIdatDiffs++;
        }
      }
      for (let j = 0; j < 4; j++) {
        if (a[i]!.crc[j] !== b[i]!.crc[j]) {
          // An IDAT-crc difference is expected (the data changed); any other
          // crc difference is a structural corruption.
          if (!isIdat) nonIdatDiffs++;
        }
      }
    }
    expect(idatDataDiffs).toBe(1);
    expect(nonIdatDiffs).toBe(0);
  });

  it('produces a tampered IDAT chunk whose stored CRC matches its (modified) data', () => {
    const original = encodePng(16, 16, (x, y) => [x * 5, y * 5, 200]);
    const tampered = tamperInsideIdat(original);

    // Walk chunks, find IDAT, recompute its CRC and compare to the stored one.
    let p = 8;
    while (p < tampered.length) {
      const len = tampered.readUInt32BE(p);
      const type = tampered.toString('ascii', p + 4, p + 8);
      if (type === 'IDAT') {
        const data = tampered.subarray(p + 8, p + 8 + len);
        const storedCrc = tampered.readUInt32BE(p + 8 + len);
        const typeBuf = Buffer.from('IDAT', 'ascii');
        const expectedCrc = crc32(Buffer.concat([typeBuf, data]));
        expect(storedCrc).toBe(expectedCrc);
        return;
      }
      p += 12 + len;
    }
    throw new Error('IDAT chunk not found in tampered PNG');
  });

  it('throws when there is no IDAT chunk to tamper', () => {
    // Hand-build a minimal PNG with no IDAT (signature + IHDR + IEND).
    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(1, 0);
    ihdr.writeUInt32BE(1, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    const len = (b: Buffer, t: string, d: Buffer) => {
      const h = Buffer.alloc(8);
      h.writeUInt32BE(d.length, 0);
      h.write(t, 4, 'ascii');
      const c = Buffer.alloc(4);
      c.writeUInt32BE(crc32(Buffer.concat([Buffer.from(t, 'ascii'), d])), 0);
      return Buffer.concat([h, d, c]);
    };
    const noIdat = Buffer.concat([sig, len(sig, 'IHDR', ihdr), len(sig, 'IEND', Buffer.alloc(0))]);
    expect(() => tamperInsideIdat(noIdat)).toThrow();
  });
});
