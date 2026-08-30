"use strict";
(function (K) {
  // FAT12 tooling for floppy/disk images: format, directory listing, add and
  // extract files. Used by the Disk Tools UI; engine-free and fully testable.

  const GEOMS = {
    "360K": { size: 368640, spt: 9, heads: 2, spc: 2, rootEnt: 112, fatSect: 2, media: 0xFD },
    "720K": { size: 737280, spt: 9, heads: 2, spc: 2, rootEnt: 112, fatSect: 3, media: 0xF9 },
    "1.44M": { size: 1474560, spt: 18, heads: 2, spc: 1, rootEnt: 224, fatSect: 9, media: 0xF0 },
  };
  K.FAT_KINDS = Object.keys(GEOMS);

  function bpbOf(img) {
    if (img.length < 512 || img[510] !== 0x55 || img[511] !== 0xAA) {
      // tolerate missing signature on some images; still try the BPB
    }
    const w = (o) => img[o] | (img[o + 1] << 8);
    const bpb = {
      bytesPerSect: w(11),
      spc: img[13],
      resSect: w(14),
      nFats: img[16],
      rootEnt: w(17),
      totSect: w(19) || (img[32] | (img[33] << 8) | (img[34] << 16) | (img[35] << 24)),
      media: img[21],
      fatSect: w(22),
    };
    if (bpb.bytesPerSect !== 512 || bpb.spc < 1 || bpb.nFats < 1 || bpb.rootEnt < 1) return null;
    bpb.fatStart = bpb.resSect * 512;
    bpb.rootStart = (bpb.resSect + bpb.nFats * bpb.fatSect) * 512;
    bpb.dataStart = bpb.rootStart + bpb.rootEnt * 32;
    bpb.clusterBytes = bpb.spc * 512;
    bpb.nClusters = Math.floor((bpb.totSect * 512 - bpb.dataStart) / bpb.clusterBytes);
    return bpb;
  }
  K.fatInfo = bpbOf;

  // --- FAT12 chain access ---
  function fatGet(img, bpb, cl) {
    const o = bpb.fatStart + Math.floor(cl * 1.5);
    const v = img[o] | (img[o + 1] << 8);
    return (cl & 1) ? (v >> 4) & 0xFFF : v & 0xFFF;
  }
  function fatSet(img, bpb, cl, val) {
    const o = bpb.fatStart + Math.floor(cl * 1.5);
    for (let f = 0; f < bpb.nFats; f++) {
      const fo = o + f * bpb.fatSect * 512;
      if (cl & 1) {
        img[fo] = (img[fo] & 0x0F) | ((val << 4) & 0xF0);
        img[fo + 1] = (val >> 4) & 0xFF;
      } else {
        img[fo] = val & 0xFF;
        img[fo + 1] = (img[fo + 1] & 0xF0) | ((val >> 8) & 0x0F);
      }
    }
  }
  function clusterOfs(bpb, cl) { return bpb.dataStart + (cl - 2) * bpb.clusterBytes; }

  // --- format a fresh image ---
  K.fatFormat = function (kind) {
    const g = GEOMS[kind];
    if (!g) return null;
    const img = new Uint8Array(g.size);
    const totSect = g.size / 512;
    const bs = [
      0xEB, 0x3C, 0x90,                                  // jmp
      0x75, 0x53, 0x59, 0x53, 0x38, 0x30, 0x38, 0x36,    // OEM "uSYS8086"
      0x00, 0x02,                                        // 512 b/sector
      g.spc, 0x01, 0x00,                                 // spc, 1 reserved
      0x02,                                              // 2 FATs
      g.rootEnt & 0xFF, g.rootEnt >> 8,
      totSect & 0xFF, (totSect >> 8) & 0xFF,
      g.media,
      g.fatSect, 0x00,
      g.spt, 0x00, g.heads, 0x00,
    ];
    img.set(bs, 0);
    // boot stub: print message via INT 19-less halt (non-bootable data disk)
    const stub = [0xCD, 0x18, 0xF4, 0xEB, 0xFD];          // int 18h; hlt; jmp $
    img.set(stub, 0x3E);
    img[510] = 0x55; img[511] = 0xAA;
    const bpb = bpbOf(img);
    // media descriptor entries in both FATs
    for (let f = 0; f < 2; f++) {
      const o = bpb.fatStart + f * bpb.fatSect * 512;
      img[o] = g.media; img[o + 1] = 0xFF; img[o + 2] = 0xFF;
    }
    return img;
  };

  // ------------------------------------------------------- hard disk images ----
  // XTIDE geometry: 306 cylinders x 4 heads x 17 sectors = 20808 sectors.
  // Layout: MBR at LBA 0 (real boot code + one FAT12 partition starting at
  // LBA 17, the classic cyl 0 / head 1 / sector 1), partition formatted
  // FAT12 with 4K clusters — period-correct and well inside FAT12 limits.
  const HDD = { cyl: 306, heads: 4, spt: 17 };
  const HDD_SECTORS = HDD.cyl * HDD.heads * HDD.spt;      // 20808
  const PART_START = 17;                                   // LBA of the partition
  const PART_SECT = HDD_SECTORS - PART_START;              // 20791
  K.HDD_BYTES = HDD_SECTORS * 512;

  // Hand-assembled MBR bootstrap: relocate 7C00h -> 0600h, read the
  // partition's boot sector (CHS 0/1/1, drive 80h) to 7C00h, jump to it.
  function mbrCode() {
    const pre = [
      0xFA,                   // cli
      0x31, 0xC0,             // xor ax,ax
      0x8E, 0xD0,             // mov ss,ax
      0xBC, 0x00, 0x7C,       // mov sp,7C00
      0xFB,                   // sti
      0x8E, 0xD8,             // mov ds,ax
      0x8E, 0xC0,             // mov es,ax
      0xBE, 0x00, 0x7C,       // mov si,7C00
      0xBF, 0x00, 0x06,       // mov di,0600
      0xB9, 0x00, 0x01,       // mov cx,0100
      0xFC,                   // cld
      0xF3, 0xA5,             // rep movsw
    ];
    const cont = 0x600 + pre.length + 5;                   // after the far jump
    const code = [
      ...pre,
      0xEA, cont & 0xFF, cont >> 8, 0x00, 0x00,           // jmp far 0000:cont
      0xB8, 0x01, 0x02,       // mov ax,0201  (read 1 sector)
      0xB9, 0x01, 0x00,       // mov cx,0001  (cyl 0, sector 1)
      0xBA, 0x80, 0x01,       // mov dx,0180  (head 1, drive 80h)
      0xBB, 0x00, 0x7C,       // mov bx,7C00
      0xCD, 0x13,             // int 13h
      0x72, 0xFE,             // jc $         (halt on error)
      0xEA, 0x00, 0x7C, 0x00, 0x00, // jmp far 0000:7C00
    ];
    return code;
  }

  // blank, partitioned, formatted 10.4MB disk; boot sector optional
  K.fatFormatHdd = function (vbrTemplate) {
    const img = new Uint8Array(K.HDD_BYTES);
    img.set(mbrCode(), 0);
    // partition entry 1 at 1BEh
    const e = 0x1BE;
    img[e] = 0x80;                                        // active
    img[e + 1] = 1; img[e + 2] = 1; img[e + 3] = 0;       // CHS start 0/1/1
    img[e + 4] = 0x01;                                    // type: FAT12
    const endCyl = HDD.cyl - 1;
    img[e + 5] = HDD.heads - 1;                           // CHS end head
    img[e + 6] = HDD.spt | (((endCyl >> 8) & 3) << 6);    // sector + cyl hi
    img[e + 7] = endCyl & 0xFF;                           // cyl lo
    const d32 = (o, v) => { img[o] = v & 0xFF; img[o + 1] = (v >> 8) & 0xFF; img[o + 2] = (v >> 16) & 0xFF; img[o + 3] = (v >> 24) & 0xFF; };
    d32(e + 8, PART_START);
    d32(e + 12, PART_SECT);
    img[510] = 0x55; img[511] = 0xAA;

    // partition boot sector: FreeDOS's code (when given) with the BPB
    // re-written for this disk, else our non-bootable data stub
    const p = img.subarray(PART_START * 512);
    if (vbrTemplate) p.set(vbrTemplate.subarray(0, 512), 0);
    else {
      p.set([0xEB, 0x3C, 0x90], 0);
      p.set([0xCD, 0x18, 0xF4, 0xEB, 0xFD], 0x3E);
    }
    const w16 = (o, v) => { p[o] = v & 0xFF; p[o + 1] = (v >> 8) & 0xFF; };
    p.set([0x75, 0x53, 0x59, 0x53, 0x38, 0x30, 0x38, 0x36], 3);  // OEM
    w16(11, 512);
    p[13] = 8;                                            // 4K clusters
    w16(14, 1);                                           // 1 reserved
    p[16] = 2;                                            // 2 FATs
    w16(17, 512);                                         // root entries
    w16(19, PART_SECT);
    p[21] = 0xF8;
    w16(22, 8);                                           // sectors per FAT
    w16(24, HDD.spt);
    w16(26, HDD.heads);
    d32(PART_START * 512 + 28, PART_START);               // hidden sectors
    p[36] = 0x80;                                         // EBPB drive number
    p[510] = 0x55; p[511] = 0xAA;
    const bpb = bpbOf(p);
    for (let f = 0; f < 2; f++) {
      const o = bpb.fatStart + f * bpb.fatSect * 512;
      p.fill(0, o, o + bpb.fatSect * 512);
      p[o] = 0xF8; p[o + 1] = 0xFF; p[o + 2] = 0xFF;
    }
    p.fill(0, bpb.rootStart, bpb.dataStart);              // clean root
    return img;
  };

  // the partition of an MBR disk as a live view (writes hit the disk image)
  K.hddPartition = function (img) {
    if (img[510] !== 0x55 || img[511] !== 0xAA) return null;
    const e = 0x1BE;
    const lba = img[e + 8] | (img[e + 9] << 8) | (img[e + 10] << 16) | (img[e + 11] << 24);
    if (!lba || lba * 512 >= img.length) return null;
    return img.subarray(lba * 512);
  };

  // The star of the show: a BOOTABLE FreeDOS system disk synthesized from the
  // embedded install floppy — no multi-megabyte HDD asset needed. Transplants
  // FreeDOS's own FAT12 boot sector (re-BPB'd for the disk geometry), then
  // copies the system files. KERNEL.SYS goes first, fresh format = contiguous.
  K.buildFreeDosHdd = function (floppyImg) {
    const img = K.fatFormatHdd(floppyImg);                // FreeDOS VBR, our BPB
    const part = K.hddPartition(img);
    // walk the install floppy: KERNEL.SYS at root, the rest in FREEDOS/BIN
    const root = K.fatList(floppyImg);
    const kernel = (() => {
      const f = root.find(x => x.name === "KERNEL.SYS");
      return f ? K.fatExtract(floppyImg, f) : null;
    })();
    const fdDir = root.find(x => x.name === "FREEDOS" && x.dir);
    const binDir = fdDir && K.fatList(floppyImg, fdDir.cluster).find(x => x.name === "BIN" && x.dir);
    const bin = binDir ? K.fatList(floppyImg, binDir.cluster) : [];
    const fromBin = (name) => {
      const f = bin.find(x => x.name === name);
      return f ? K.fatExtract(floppyImg, f) : null;
    };
    const shell = fromBin("COMMAND.COM");
    if (!kernel || !shell) return null;
    K.fatAdd(part, "KERNEL.SYS", kernel);                 // first entry, contiguous
    K.fatAdd(part, "COMMAND.COM", shell);
    // a usable C:\DOS toolkit, straight off the install floppy
    for (const tool of ["FDISK.EXE", "FORMAT.EXE", "SYS.COM", "MEM.EXE", "MORE.EXE",
                        "ATTRIB.COM", "DELTREE.COM", "FC.EXE", "FDISK.INI"]) {
      const b = fromBin(tool);
      if (b) K.fatAdd(part, "DOS/" + tool, b);
    }
    const text = (s2) => Uint8Array.from(s2, c => c.charCodeAt(0));
    K.fatAdd(part, "CONFIG.SYS", text("SHELL=C:\\COMMAND.COM /E:1024 /P\r\n"));
    K.fatAdd(part, "AUTOEXEC.BAT", text("@ECHO OFF\r\nPATH C:\\DOS\r\nPROMPT $P$G\r\nECHO uSYSTEM 8086 - FreeDOS system disk (synthesized on demand)\r\n"));
    return img;
  };

  // --- directory listing (root, or a subdirectory by start cluster) ---
  function scanEntries(img, regions) {
    const out = [];
    for (const [start, count, base] of regions) {
      for (let i = 0; i < count; i++) {
        const o = start + i * 32;
        const first = img[o];
        if (first === 0x00) return out;
        if (first === 0xE5) continue;                    // deleted
        const attr = img[o + 11];
        if (attr === 0x0F) continue;                     // LFN entry
        if (attr & 0x08) continue;                       // volume label
        const raw = [];
        for (let j = 0; j < 11; j++) raw.push(img[o + j]);
        const b8 = String.fromCharCode(...raw.slice(0, 8)).trimEnd();
        const ext = String.fromCharCode(...raw.slice(8, 11)).trimEnd();
        if (b8 === "." || b8 === "..") continue;
        out.push({
          name: ext ? b8 + "." + ext : b8,
          attr,
          dir: (attr & 0x10) !== 0,
          size: img[o + 28] | (img[o + 29] << 8) | (img[o + 30] << 16) | (img[o + 31] << 24),
          cluster: img[o + 26] | (img[o + 27] << 8),
          entryOfs: o,
        });
      }
    }
    return out;
  }
  K.fatList = function (img, dirCluster) {
    const bpb = bpbOf(img);
    if (!bpb) return null;
    if (!dirCluster) return scanEntries(img, [[bpb.rootStart, bpb.rootEnt, 0]]);
    const regions = [];
    let cl = dirCluster, guard = 0;
    while (cl >= 2 && cl < 0xFF0 && guard++ < 4096) {
      regions.push([clusterOfs(bpb, cl), bpb.clusterBytes / 32, 0]);
      cl = fatGet(img, bpb, cl);
    }
    return scanEntries(img, regions);
  };

  K.fatExtract = function (img, entry) {
    const bpb = bpbOf(img);
    if (!bpb) return null;
    const out = new Uint8Array(entry.size);
    let cl = entry.cluster, written = 0, guard = 0;
    while (cl >= 2 && cl < 0xFF0 && written < entry.size && guard++ < 65536) {
      const src = clusterOfs(bpb, cl);
      const n = Math.min(bpb.clusterBytes, entry.size - written);
      out.set(img.subarray(src, src + n), written);
      written += n;
      cl = fatGet(img, bpb, cl);
    }
    return out;
  };

  // --- add a file to the root directory ---
  function to83(name) {
    const up = name.toUpperCase().replace(/[^A-Z0-9_\-~!#$%&(){}@'`.]/g, "_");
    const dot = up.lastIndexOf(".");
    let base = dot > 0 ? up.slice(0, dot) : up;
    let ext = dot > 0 ? up.slice(dot + 1) : "";
    base = base.replace(/\./g, "_").slice(0, 8).padEnd(8, " ");
    ext = ext.slice(0, 3).padEnd(3, " ");
    return base + ext;
  }
  // allocate n free clusters (zeroed), chained; returns list or null
  function allocClusters(img, bpb, n) {
    const free = [];
    for (let cl = 2; cl < bpb.nClusters + 2 && free.length < n; cl++)
      if (fatGet(img, bpb, cl) === 0) free.push(cl);
    if (free.length < n) return null;
    for (let i = 0; i < n; i++) {
      const dst = clusterOfs(bpb, free[i]);
      img.fill(0, dst, dst + bpb.clusterBytes);
      fatSet(img, bpb, free[i], i + 1 < n ? free[i + 1] : 0xFFF);
    }
    return free;
  }

  function writeDirEntry(img, slot, short, attr, cluster, size) {
    for (let j = 0; j < 11; j++) img[slot + j] = short.charCodeAt(j);
    img[slot + 11] = attr;
    img.fill(0, slot + 12, slot + 26);
    const dt = 0x2821, tm = 0x6000;                       // fixed timestamp
    img[slot + 22] = tm & 0xFF; img[slot + 23] = tm >> 8;
    img[slot + 24] = dt & 0xFF; img[slot + 25] = dt >> 8;
    img[slot + 26] = cluster & 0xFF; img[slot + 27] = cluster >> 8;
    img[slot + 28] = size & 0xFF; img[slot + 29] = (size >> 8) & 0xFF;
    img[slot + 30] = (size >> 16) & 0xFF; img[slot + 31] = (size >>> 24) & 0xFF;
  }

  // a free 32-byte slot in a directory (root region, or a subdir's cluster
  // chain — extended with a fresh cluster when full). dirCluster 0 = root.
  function findSlot(img, bpb, dirCluster) {
    if (!dirCluster) {
      for (let i = 0; i < bpb.rootEnt; i++) {
        const o = bpb.rootStart + i * 32;
        if (img[o] === 0x00 || img[o] === 0xE5) return o;
      }
      return -1;
    }
    let cl = dirCluster, last = cl;
    while (cl >= 2 && cl < 0xFF8) {
      const base = clusterOfs(bpb, cl);
      for (let i = 0; i < bpb.clusterBytes / 32; i++) {
        const o = base + i * 32;
        if (img[o] === 0x00 || img[o] === 0xE5) return o;
      }
      last = cl;
      cl = fatGet(img, bpb, cl);
    }
    const ext = allocClusters(img, bpb, 1);               // grow the directory
    if (!ext) return -1;
    fatSet(img, bpb, last, ext[0]);
    return clusterOfs(bpb, ext[0]);
  }

  function findIn(img, bpb, dirCluster, short) {
    const list = K.fatList(img, dirCluster || undefined);
    return list.find(f => to83(f.name) === short) || null;
  }

  // create (or find) a subdirectory; returns its start cluster
  function mkdirIn(img, bpb, dirCluster, name) {
    const short = to83(name);
    const ex = findIn(img, bpb, dirCluster, short);
    if (ex) return ex.dir ? ex.cluster : -1;              // -1: a FILE is in the way
    const cls = allocClusters(img, bpb, 1);
    if (!cls) return -1;
    const slot = findSlot(img, bpb, dirCluster);
    if (slot < 0) return -1;
    writeDirEntry(img, slot, short, 0x10, cls[0], 0);
    const base = clusterOfs(bpb, cls[0]);
    writeDirEntry(img, base, ".          ", 0x10, cls[0], 0);
    writeDirEntry(img, base + 32, "..         ", 0x10, dirCluster || 0, 0);
    return cls[0];
  }
  K.fatMkdir = function (img, path) {
    const bpb = bpbOf(img);
    if (!bpb) return -1;
    let dir = 0;
    for (const part of String(path).split("/").filter(Boolean)) {
      dir = mkdirIn(img, bpb, dir, part);
      if (dir < 0) return -1;
    }
    return dir;
  };

  // path-aware add: "DOS/MEM.EXE" creates DOS/ as needed
  K.fatAdd = function (img, name, bytes) {
    const bpb = bpbOf(img);
    if (!bpb) return "not a FAT12 image";
    const parts = String(name).split("/").filter(Boolean);
    const fname = parts.pop();
    let dir = 0;
    for (const p of parts) {
      dir = mkdirIn(img, bpb, dir, p);
      if (dir < 0) return "cannot create directory " + p;
    }
    const short = to83(fname);
    if (findIn(img, bpb, dir, short)) return "file already exists";
    const need = Math.max(0, Math.ceil(bytes.length / bpb.clusterBytes));
    const free = need ? allocClusters(img, bpb, need) : [];
    if (!free) return "image full";
    for (let i = 0; i < need; i++)
      img.set(bytes.subarray(i * bpb.clusterBytes, (i + 1) * bpb.clusterBytes), clusterOfs(bpb, free[i]));
    const slot = findSlot(img, bpb, dir);
    if (slot < 0) return "directory full";
    writeDirEntry(img, slot, short, 0x20, bytes.length ? free[0] : 0, bytes.length);
    return null;                                          // success
  };

  K.fatDelete = function (img, entry) {
    const bpb = bpbOf(img);
    if (!bpb) return "not a FAT12 image";
    let cl = entry.cluster, guard = 0;
    while (cl >= 2 && cl < 0xFF0 && guard++ < 65536) {
      const next = fatGet(img, bpb, cl);
      fatSet(img, bpb, cl, 0);
      cl = next;
    }
    img[entry.entryOfs] = 0xE5;
    return null;
  };
})(globalThis.K8086 ??= {});
