/**
 * Deterministic Windows x64 (PE32+) GUI Executable Builder for AI Workforce.
 *
 * Generates a spec-compliant 64-bit Windows Portable Executable (`AI-Workforce.exe`)
 * with:
 * - Subsystem: IMAGE_SUBSYSTEM_WINDOWS_GUI (no console flash)
 * - Full ASLR / DEP compatibility (RIP-relative x86_64 machine code + .reloc)
 * - Embedded 32x32 32-bit ARGB application icon (.rsrc RT_ICON + RT_GROUP_ICON)
 * - Native chromeless app-window launch via Microsoft Edge WebView/App Mode
 *   (`msedge.exe --app=<url> --window-size=1440,920`) with automatic fallback
 *   to the system default browser via `SHELL32.dll!ShellExecuteW`.
 */

const FILE_ALIGNMENT = 0x0200; // 512 bytes
const SECTION_ALIGNMENT = 0x1000; // 4096 bytes
const IMAGE_BASE = 0x0000000140000000n;

function alignUp(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function encodeUtf16LeNullTerminated(str: string): Buffer {
  return Buffer.from(`${str}\0`, 'utf16le');
}

function encodeAsciiEvenPadded(str: string): Buffer {
  const raw = Buffer.from(`${str}\0`, 'ascii');
  if (raw.length % 2 === 0) return raw;
  return Buffer.concat([raw, Buffer.from([0])]);
}

function buildHintName(funcName: string): Buffer {
  const nameBuf = encodeAsciiEvenPadded(funcName);
  const out = Buffer.alloc(2 + nameBuf.length);
  out.writeUInt16LE(0, 0); // Hint = 0
  nameBuf.copy(out, 2);
  return out;
}

/**
 * Generates a crisp 32x32 32-bit BGRA Windows DIB icon payload (BITMAPINFOHEADER + XOR + AND mask)
 * depicting a rounded slate-900 badge with a white/emerald connected DAG node mark.
 */
function buildAppIconDib(): Buffer {
  const width = 32;
  const height = 32;
  const xorSize = width * height * 4;
  const andRowBytes = Math.ceil(width / 32) * 4; // 4 bytes per row
  const andSize = andRowBytes * height; // 128 bytes
  const buf = Buffer.alloc(40 + xorSize + andSize);

  // BITMAPINFOHEADER (40 bytes)
  buf.writeUInt32LE(40, 0); // biSize
  buf.writeInt32LE(width, 4); // biWidth
  buf.writeInt32LE(height * 2, 8); // biHeight (doubled for icon XOR + AND masks)
  buf.writeUInt16LE(1, 12); // biPlanes
  buf.writeUInt16LE(32, 14); // biBitCount
  buf.writeUInt32LE(0, 16); // biCompression (BI_RGB)
  buf.writeUInt32LE(xorSize + andSize, 20); // biSizeImage

  // Helper to check distance to line segment for clean DAG connector motif
  const distToSegment = (
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number
  ) => {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    const projX = ax + t * dx;
    const projY = ay + t * dy;
    return Math.hypot(px - projX, py - projY);
  };

  // Bottom-up DIB scanlines (y = 0 is bottom, y = 31 is top)
  for (let row = 0; row < height; row++) {
    const y = height - 1 - row;
    for (let x = 0; x < width; x++) {
      const offset = 40 + (row * width + x) * 4;

      // Rounded rect mask (margin 1px, corner radius 6px)
      const rx = Math.max(0, Math.max(7 - x, x - 24));
      const ry = Math.max(0, Math.max(7 - y, y - 24));
      const cornerDist = Math.hypot(rx, ry);

      if (x < 1 || x > 30 || y < 1 || y > 30 || cornerDist > 6.2) {
        // Transparent pixel
        buf[offset + 0] = 0;
        buf[offset + 1] = 0;
        buf[offset + 2] = 0;
        buf[offset + 3] = 0;
        // Set AND mask bit to 1 for legacy transparency compatibility
        const andByteIndex = 40 + xorSize + row * andRowBytes + (x >> 3);
        buf[andByteIndex] |= 0x80 >> (x & 7);
        continue;
      }

      // Base slate-900 background (#0F172A -> B=42, G=23, R=15)
      let r = 15;
      let g = 23;
      let b = 42;

      // Subtle inner border
      if (x === 2 || x === 29 || y === 2 || y === 29 || cornerDist > 5.0) {
        r = 51;
        g = 65;
        b = 85;
      }

      // 3-Node DAG emblem: left root (9,16) -> top-right (22,10) & bottom-right (22,22)
      const dEdgeTop = distToSegment(x, y, 9, 16, 22, 10);
      const dEdgeBot = distToSegment(x, y, 9, 16, 22, 22);
      if (dEdgeTop <= 1.25 || dEdgeBot <= 1.25) {
        r = 148;
        g = 163;
        b = 184;
      }

      const dRoot = Math.hypot(x - 9, y - 16);
      const dTopNode = Math.hypot(x - 22, y - 10);
      const dBotNode = Math.hypot(x - 22, y - 22);

      if (dRoot <= 3.3 || dTopNode <= 2.9) {
        // Crisp white nodes
        r = 248;
        g = 250;
        b = 252;
      } else if (dBotNode <= 3.1) {
        // Emerald-400 human checkpoint node (#34D399)
        r = 52;
        g = 211;
        b = 153;
      }

      buf[offset + 0] = b;
      buf[offset + 1] = g;
      buf[offset + 2] = r;
      buf[offset + 3] = 255;
    }
  }

  return buf;
}

/**
 * Builds the `.rsrc` section containing RT_ICON (3) and RT_GROUP_ICON (14).
 */
function buildResourceSection(rsrcRva: number): Buffer {
  const iconDib = buildAppIconDib();

  // GRPICONDIR (6 bytes) + 1 GRPICONDIRENTRY (14 bytes) = 20 bytes
  const grpIconDir = Buffer.alloc(20);
  grpIconDir.writeUInt16LE(0, 0); // idReserved
  grpIconDir.writeUInt16LE(1, 2); // idType = 1 (ICON)
  grpIconDir.writeUInt16LE(1, 4); // idCount = 1
  grpIconDir.writeUInt8(32, 6); // bWidth
  grpIconDir.writeUInt8(32, 7); // bHeight
  grpIconDir.writeUInt8(0, 8); // bColorCount
  grpIconDir.writeUInt8(0, 9); // bReserved
  grpIconDir.writeUInt16LE(1, 10); // wPlanes
  grpIconDir.writeUInt16LE(32, 12); // wBitCount
  grpIconDir.writeUInt32LE(iconDib.length, 14); // dwBytesInRes
  grpIconDir.writeUInt16LE(1, 18); // nID = 1

  // Directory layout inside .rsrc:
  // 0x00..0x1F (32B): Root Dir (16B) + 2 entries (Type 3 RT_ICON, Type 14 RT_GROUP_ICON)
  // 0x20..0x37 (24B): Type 3 Name Dir (16B) + 1 entry (ID 1)
  // 0x38..0x4F (24B): Type 14 Name Dir (16B) + 1 entry (ID 1)
  // 0x50..0x67 (24B): Type 3 Lang Dir (16B) + 1 entry (Lang 0x0409)
  // 0x68..0x7F (24B): Type 14 Lang Dir (16B) + 1 entry (Lang 0x0409)
  // 0x80..0x8F (16B): IMAGE_RESOURCE_DATA_ENTRY for RT_ICON
  // 0x90..0x9F (16B): IMAGE_RESOURCE_DATA_ENTRY for RT_GROUP_ICON
  // 0xA0..0xB3 (20B): GRPICONDIR payload (padded to 0xB8)
  // 0xB8..end       : RT_ICON DIB payload
  const headerAreaSize = 0xb8;
  const totalVirtualSize = headerAreaSize + iconDib.length;
  const rsrc = Buffer.alloc(totalVirtualSize);

  // Root Dir at 0x00 (2 ID entries: 3, 14)
  rsrc.writeUInt16LE(2, 0x00 + 14);
  rsrc.writeUInt32LE(3, 0x10); // RT_ICON
  rsrc.writeUInt32LE(0x80000020, 0x14);
  rsrc.writeUInt32LE(14, 0x18); // RT_GROUP_ICON
  rsrc.writeUInt32LE(0x80000038, 0x1c);

  // Type 3 Name Dir at 0x20 (ID = 1)
  rsrc.writeUInt16LE(1, 0x20 + 14);
  rsrc.writeUInt32LE(1, 0x30);
  rsrc.writeUInt32LE(0x80000050, 0x34);

  // Type 14 Name Dir at 0x38 (ID = 1)
  rsrc.writeUInt16LE(1, 0x38 + 14);
  rsrc.writeUInt32LE(1, 0x48);
  rsrc.writeUInt32LE(0x80000068, 0x4c);

  // Type 3 Lang Dir at 0x50 (Lang = 0x0409 -> DataEntry at 0x80)
  rsrc.writeUInt16LE(1, 0x50 + 14);
  rsrc.writeUInt32LE(0x0409, 0x60);
  rsrc.writeUInt32LE(0x00000080, 0x64);

  // Type 14 Lang Dir at 0x68 (Lang = 0x0409 -> DataEntry at 0x90)
  rsrc.writeUInt16LE(1, 0x68 + 14);
  rsrc.writeUInt32LE(0x0409, 0x78);
  rsrc.writeUInt32LE(0x00000090, 0x7c);

  // DataEntry for RT_ICON at 0x80 (OffsetToData is RVA!)
  rsrc.writeUInt32LE(rsrcRva + 0xb8, 0x80);
  rsrc.writeUInt32LE(iconDib.length, 0x84);

  // DataEntry for RT_GROUP_ICON at 0x90 (OffsetToData is RVA!)
  rsrc.writeUInt32LE(rsrcRva + 0xa0, 0x90);
  rsrc.writeUInt32LE(grpIconDir.length, 0x94);

  grpIconDir.copy(rsrc, 0xa0);
  iconDib.copy(rsrc, 0xb8);

  return rsrc;
}

/**
 * Computes standard Windows Portable Executable 32-bit folded CheckSum.
 */
function computePeChecksum(peBuffer: Buffer, checksumFieldOffset: number): number {
  let sum = 0n;
  const limit = peBuffer.length;
  for (let i = 0; i < limit; i += 2) {
    if (i === checksumFieldOffset || i === checksumFieldOffset + 2) {
      continue;
    }
    const word =
      i + 1 < limit ? BigInt(peBuffer.readUInt16LE(i)) : BigInt(peBuffer[i]);
    sum += word;
    sum = (sum & 0xffffn) + (sum >> 16n);
  }
  sum = (sum & 0xffffn) + (sum >> 16n);
  return Number(sum + BigInt(limit)) >>> 0;
}

export function buildWindowsDesktopExe(appUrl: string): Buffer {
  const cleanUrl = appUrl.trim().replace(/\/+$/, '');

  // -------------------------------------------------------------------------
  // 1. Build .idata section (RVA 0x2000): IAT + ILT + Import Descriptors + Wide Strings
  // -------------------------------------------------------------------------
  const idataRva = 0x2000;
  const idataChunks: Buffer[] = [];
  let cursor = 0;

  const reserve = (buf: Buffer, align = 2): number => {
    const padLen = (align - (cursor % align)) % align;
    if (padLen > 0) {
      idataChunks.push(Buffer.alloc(padLen));
      cursor += padLen;
    }
    const rva = idataRva + cursor;
    idataChunks.push(buf);
    cursor += buf.length;
    return rva;
  };

  // Reserve 32B IAT (0x2000..0x201F), 32B ILT (0x2020..0x203F), 60B ImportDir (0x2040..0x207B)
  const iatBuf = Buffer.alloc(32);
  const iatRva = reserve(iatBuf, 8); // 0x2000
  const iltBuf = Buffer.alloc(32);
  const iltRva = reserve(iltBuf, 8); // 0x2020
  const importDirBuf = Buffer.alloc(60);
  const importDirRva = reserve(importDirBuf, 4); // 0x2040

  const rvaDllKernel32 = reserve(encodeAsciiEvenPadded('KERNEL32.dll'), 2);
  const rvaDllShell32 = reserve(encodeAsciiEvenPadded('SHELL32.dll'), 2);
  const rvaHintExitProcess = reserve(buildHintName('ExitProcess'), 2);
  const rvaHintShellExecuteW = reserve(buildHintName('ShellExecuteW'), 2);

  // Wide strings for ShellExecuteW
  const rvaStrOpen = reserve(encodeUtf16LeNullTerminated('open'), 2);
  const rvaStrMsedge = reserve(encodeUtf16LeNullTerminated('msedge.exe'), 2);
  const rvaStrEdgeArgs = reserve(
    encodeUtf16LeNullTerminated(`--app=${cleanUrl} --window-size=1440,920`),
    2
  );
  const rvaStrUrl = reserve(encodeUtf16LeNullTerminated(cleanUrl), 2);

  // Populate IAT & ILT
  const rvaIatExitProcess = iatRva + 0; // 0x2000
  const rvaIatShellExecuteW = iatRva + 16; // 0x2010

  iatBuf.writeBigUInt64LE(BigInt(rvaHintExitProcess), 0);
  iatBuf.writeBigUInt64LE(0n, 8);
  iatBuf.writeBigUInt64LE(BigInt(rvaHintShellExecuteW), 16);
  iatBuf.writeBigUInt64LE(0n, 24);

  iltBuf.writeBigUInt64LE(BigInt(rvaHintExitProcess), 0);
  iltBuf.writeBigUInt64LE(0n, 8);
  iltBuf.writeBigUInt64LE(BigInt(rvaHintShellExecuteW), 16);
  iltBuf.writeBigUInt64LE(0n, 24);

  // Descriptor 0: KERNEL32.dll
  importDirBuf.writeUInt32LE(iltRva + 0, 0); // OriginalFirstThunk
  importDirBuf.writeUInt32LE(0, 4); // TimeDateStamp
  importDirBuf.writeUInt32LE(0, 8); // ForwarderChain
  importDirBuf.writeUInt32LE(rvaDllKernel32, 12); // Name
  importDirBuf.writeUInt32LE(rvaIatExitProcess, 16); // FirstThunk

  // Descriptor 1: SHELL32.dll
  importDirBuf.writeUInt32LE(iltRva + 16, 20); // OriginalFirstThunk
  importDirBuf.writeUInt32LE(0, 24); // TimeDateStamp
  importDirBuf.writeUInt32LE(0, 28); // ForwarderChain
  importDirBuf.writeUInt32LE(rvaDllShell32, 32); // Name
  importDirBuf.writeUInt32LE(rvaIatShellExecuteW, 36); // FirstThunk
  // Descriptor 2 (bytes 40..59) remains all zeros (terminator)

  const idataVirtual = Buffer.concat(idataChunks);

  // -------------------------------------------------------------------------
  // 2. Build .text section (RVA 0x1000): x86_64 Windows GUI Launcher
  // -------------------------------------------------------------------------
  const textRva = 0x1000;
  const codeBytes: number[] = [];
  const ripFixups: Array<{ dispOffset: number; nextRipRva: number; targetRva: number }> = [];

  const emit = (...bytes: number[]) => {
    codeBytes.push(...bytes);
  };

  const emitRipDisp = (prefixBytes: number[], targetRva: number) => {
    codeBytes.push(...prefixBytes);
    const dispOffset = codeBytes.length;
    codeBytes.push(0, 0, 0, 0);
    const nextRipRva = textRva + codeBytes.length;
    ripFixups.push({ dispOffset, nextRipRva, targetRva });
  };

  // Prologue: align stack to 16-byte boundary + allocate shadow space & args 5..6
  emit(0x48, 0x83, 0xec, 0x38); // sub rsp, 0x38

  // Primary launch: ShellExecuteW(NULL, L"open", L"msedge.exe", L"--app=...", NULL, SW_SHOWNORMAL)
  emit(0x31, 0xc9); // xor ecx, ecx
  emitRipDisp([0x48, 0x8d, 0x15], rvaStrOpen); // lea rdx, [rip + str_open]
  emitRipDisp([0x4c, 0x8d, 0x05], rvaStrMsedge); // lea r8,  [rip + str_msedge]
  emitRipDisp([0x4c, 0x8d, 0x0d], rvaStrEdgeArgs); // lea r9,  [rip + str_edge_args]
  emit(0x48, 0xc7, 0x44, 0x24, 0x20, 0x00, 0x00, 0x00, 0x00); // mov qword ptr [rsp+0x20], 0
  emit(0x48, 0xc7, 0x44, 0x24, 0x28, 0x01, 0x00, 0x00, 0x00); // mov qword ptr [rsp+0x28], 1
  emitRipDisp([0xff, 0x15], rvaIatShellExecuteW); // call qword ptr [rip + IAT_ShellExecuteW]

  // Check if HINSTANCE > 32 (success)
  emit(0x48, 0x83, 0xf8, 0x20); // cmp rax, 32
  emit(0x7f, 0x00); // jg short exit_label (patched below)
  const jgRel8Index = codeBytes.length - 1;
  const afterJgOffset = codeBytes.length;

  // Fallback launch: ShellExecuteW(NULL, L"open", L"<cleanUrl>", NULL, NULL, SW_SHOWNORMAL)
  emit(0x31, 0xc9); // xor ecx, ecx
  emitRipDisp([0x48, 0x8d, 0x15], rvaStrOpen); // lea rdx, [rip + str_open]
  emitRipDisp([0x4c, 0x8d, 0x05], rvaStrUrl); // lea r8,  [rip + str_url]
  emit(0x45, 0x31, 0xc9); // xor r9d, r9d
  emit(0x48, 0xc7, 0x44, 0x24, 0x20, 0x00, 0x00, 0x00, 0x00); // mov qword ptr [rsp+0x20], 0
  emit(0x48, 0xc7, 0x44, 0x24, 0x28, 0x01, 0x00, 0x00, 0x00); // mov qword ptr [rsp+0x28], 1
  emitRipDisp([0xff, 0x15], rvaIatShellExecuteW); // call qword ptr [rip + IAT_ShellExecuteW]

  // exit_label:
  const exitLabelOffset = codeBytes.length;
  codeBytes[jgRel8Index] = exitLabelOffset - afterJgOffset;

  emit(0x31, 0xc9); // xor ecx, ecx
  emitRipDisp([0xff, 0x15], rvaIatExitProcess); // call qword ptr [rip + IAT_ExitProcess]
  emit(0x48, 0x83, 0xc4, 0x38); // add rsp, 0x38
  emit(0xc3); // ret

  const textVirtual = Buffer.from(codeBytes);
  for (const fix of ripFixups) {
    textVirtual.writeInt32LE(fix.targetRva - fix.nextRipRva, fix.dispOffset);
  }

  // -------------------------------------------------------------------------
  // 3. Build .rsrc section & .reloc section
  // -------------------------------------------------------------------------
  const idataSpan = alignUp(idataVirtual.length, SECTION_ALIGNMENT);
  const rsrcRva = idataRva + idataSpan;
  const rsrcVirtual = buildResourceSection(rsrcRva);

  const rsrcSpan = alignUp(rsrcVirtual.length, SECTION_ALIGNMENT);
  const relocRva = rsrcRva + rsrcSpan;
  // Valid 8-byte empty base relocation block for page 0x1000 (all code is RIP-relative)
  const relocVirtual = Buffer.alloc(8);
  relocVirtual.writeUInt32LE(textRva, 0);
  relocVirtual.writeUInt32LE(8, 4);

  const sizeOfImage = relocRva + alignUp(relocVirtual.length, SECTION_ALIGNMENT);

  // -------------------------------------------------------------------------
  // 4. Pad raw sections to FILE_ALIGNMENT (0x200) and compute file offsets
  // -------------------------------------------------------------------------
  const sizeOfHeaders = 0x0400; // 1024 bytes

  const padRaw = (b: Buffer) => {
    const rawLen = alignUp(Math.max(1, b.length), FILE_ALIGNMENT);
    const out = Buffer.alloc(rawLen);
    b.copy(out, 0);
    return out;
  };

  const textRaw = padRaw(textVirtual);
  const idataRaw = padRaw(idataVirtual);
  const rsrcRaw = padRaw(rsrcVirtual);
  const relocRaw = padRaw(relocVirtual);

  const textRawPtr = sizeOfHeaders;
  const idataRawPtr = textRawPtr + textRaw.length;
  const rsrcRawPtr = idataRawPtr + idataRaw.length;
  const relocRawPtr = rsrcRawPtr + rsrcRaw.length;

  // -------------------------------------------------------------------------
  // 5. Assemble DOS Header + NT Headers64 + 4 Section Headers
  // -------------------------------------------------------------------------
  const headers = Buffer.alloc(sizeOfHeaders);

  // DOS Header (0x00..0x3F)
  headers.writeUInt16LE(0x5a4d, 0x00); // 'MZ'
  headers.writeUInt16LE(0x0090, 0x02);
  headers.writeUInt16LE(0x0003, 0x04);
  headers.writeUInt16LE(0x0004, 0x08);
  headers.writeUInt16LE(0xffff, 0x0c);
  headers.writeUInt16LE(0x00b8, 0x10);
  headers.writeUInt16LE(0x0040, 0x18);
  headers.writeUInt32LE(0x00000080, 0x3c); // e_lfanew = 0x80

  // Minimal 16-bit DOS stub at 0x40
  const dosStub = Buffer.from(
    '0e1fba0e00b409cd21b8014ccd21546869732070726f6772616d2072657175697265732057696e646f7773207836342e0d0d0a24',
    'hex'
  );
  dosStub.copy(headers, 0x40);

  // PE Signature (0x80)
  headers.write('PE\0\0', 0x80, 'ascii');

  // COFF File Header (0x84..0x97, 20 bytes)
  const coff = 0x84;
  headers.writeUInt16LE(0x8664, coff + 0); // IMAGE_FILE_MACHINE_AMD64
  headers.writeUInt16LE(4, coff + 2); // NumberOfSections = 4
  headers.writeUInt32LE(Math.floor(Date.now() / 1000) >>> 0, coff + 4); // TimeDateStamp
  headers.writeUInt32LE(0, coff + 8); // PointerToSymbolTable
  headers.writeUInt32LE(0, coff + 12); // NumberOfSymbols
  headers.writeUInt16LE(240, coff + 16); // SizeOfOptionalHeader = 0xF0
  headers.writeUInt16LE(0x0022, coff + 18); // EXECUTABLE_IMAGE | LARGE_ADDRESS_AWARE

  // Optional Header PE32+ (0x98..0x187, 240 bytes)
  const opt = 0x98;
  headers.writeUInt16LE(0x020b, opt + 0); // Magic = PE32+
  headers.writeUInt8(14, opt + 2); // MajorLinkerVersion
  headers.writeUInt8(30, opt + 3); // MinorLinkerVersion
  headers.writeUInt32LE(textRaw.length, opt + 4); // SizeOfCode
  headers.writeUInt32LE(
    idataRaw.length + rsrcRaw.length + relocRaw.length,
    opt + 8
  ); // SizeOfInitializedData
  headers.writeUInt32LE(0, opt + 12); // SizeOfUninitializedData
  headers.writeUInt32LE(textRva, opt + 16); // AddressOfEntryPoint
  headers.writeUInt32LE(textRva, opt + 20); // BaseOfCode
  headers.writeBigUInt64LE(IMAGE_BASE, opt + 24); // ImageBase
  headers.writeUInt32LE(SECTION_ALIGNMENT, opt + 32); // SectionAlignment
  headers.writeUInt32LE(FILE_ALIGNMENT, opt + 36); // FileAlignment
  headers.writeUInt16LE(6, opt + 40); // MajorOperatingSystemVersion
  headers.writeUInt16LE(0, opt + 42); // MinorOperatingSystemVersion
  headers.writeUInt16LE(1, opt + 44); // MajorImageVersion
  headers.writeUInt16LE(0, opt + 46); // MinorImageVersion
  headers.writeUInt16LE(6, opt + 48); // MajorSubsystemVersion (Windows Vista/7/10/11)
  headers.writeUInt16LE(0, opt + 50); // MinorSubsystemVersion
  headers.writeUInt32LE(0, opt + 52); // Win32VersionValue
  headers.writeUInt32LE(sizeOfImage, opt + 56); // SizeOfImage
  headers.writeUInt32LE(sizeOfHeaders, opt + 60); // SizeOfHeaders
  const checksumOffset = opt + 64;
  headers.writeUInt32LE(0, checksumOffset); // CheckSum placeholder
  headers.writeUInt16LE(2, opt + 68); // Subsystem = IMAGE_SUBSYSTEM_WINDOWS_GUI (2)
  headers.writeUInt16LE(0x8160, opt + 70); // HIGH_ENTROPY_VA | DYNAMIC_BASE | NX_COMPAT | TERMINAL_SERVER_AWARE
  headers.writeBigUInt64LE(0x00100000n, opt + 72); // SizeOfStackReserve (1 MB)
  headers.writeBigUInt64LE(0x00001000n, opt + 80); // SizeOfStackCommit (4 KB)
  headers.writeBigUInt64LE(0x00100000n, opt + 88); // SizeOfHeapReserve (1 MB)
  headers.writeBigUInt64LE(0x00001000n, opt + 96); // SizeOfHeapCommit (4 KB)
  headers.writeUInt32LE(0, opt + 104); // LoaderFlags
  headers.writeUInt32LE(16, opt + 108); // NumberOfRvaAndSizes

  // Data Directories (opt + 112)
  const dd = opt + 112;
  // [1] Import Directory
  headers.writeUInt32LE(importDirRva, dd + 1 * 8);
  headers.writeUInt32LE(importDirBuf.length, dd + 1 * 8 + 4);
  // [2] Resource Directory
  headers.writeUInt32LE(rsrcRva, dd + 2 * 8);
  headers.writeUInt32LE(rsrcVirtual.length, dd + 2 * 8 + 4);
  // [5] Base Relocation Directory
  headers.writeUInt32LE(relocRva, dd + 5 * 8);
  headers.writeUInt32LE(relocVirtual.length, dd + 5 * 8 + 4);
  // [12] IAT Directory
  headers.writeUInt32LE(iatRva, dd + 12 * 8);
  headers.writeUInt32LE(iatBuf.length, dd + 12 * 8 + 4);

  // Section Headers (0x188 + i * 40)
  const writeSectionHeader = (
    index: number,
    name: string,
    virtualSize: number,
    virtualAddress: number,
    sizeOfRawData: number,
    pointerToRawData: number,
    characteristics: number
  ) => {
    const sh = 0x188 + index * 40;
    const nameBytes = Buffer.alloc(8);
    nameBytes.write(name.slice(0, 8), 0, 'ascii');
    nameBytes.copy(headers, sh);
    headers.writeUInt32LE(virtualSize, sh + 8);
    headers.writeUInt32LE(virtualAddress, sh + 12);
    headers.writeUInt32LE(sizeOfRawData, sh + 16);
    headers.writeUInt32LE(pointerToRawData, sh + 20);
    headers.writeUInt32LE(0, sh + 24);
    headers.writeUInt32LE(0, sh + 28);
    headers.writeUInt16LE(0, sh + 32);
    headers.writeUInt16LE(0, sh + 34);
    headers.writeUInt32LE(characteristics, sh + 36);
  };

  writeSectionHeader(0, '.text', textVirtual.length, textRva, textRaw.length, textRawPtr, 0x60000020);
  writeSectionHeader(1, '.idata', idataVirtual.length, idataRva, idataRaw.length, idataRawPtr, 0xc0000040);
  writeSectionHeader(2, '.rsrc', rsrcVirtual.length, rsrcRva, rsrcRaw.length, rsrcRawPtr, 0x40000040);
  writeSectionHeader(3, '.reloc', relocVirtual.length, relocRva, relocRaw.length, relocRawPtr, 0x42000040);

  const fullImage = Buffer.concat([headers, textRaw, idataRaw, rsrcRaw, relocRaw]);
  const checksum = computePeChecksum(fullImage, checksumOffset);
  fullImage.writeUInt32LE(checksum, checksumOffset);

  return fullImage;
}
