# Embedded third-party software

The built `index.html` embeds the following, each redistributed under its own license:

- **GLaBIOS 0.4.2 (8X build)** — `glabios.b64` — © 2022-2026 640KB,
  GNU GPL v3. Source: https://github.com/640-KB/GLaBIOS
- **FreeDOS 1.3 Floppy Edition boot disk (144m/x86BOOT.img)** — `freedos144.b64` —
  the FreeDOS kernel and utilities are GNU GPL v2+ (individual packages carry
  their own licenses). Source: https://www.freedos.org / ibiblio.org FreeDOS archive
- **font8x8** glyphs (expanded to 8×14 in `src/16-font.js`) — Daniel Hepper /
  Marcel Sondaar / IBM public-domain VGA fonts — Public Domain.

µSystem 8086 itself is licensed under the GNU GPL, version 3 or later, which is
compatible with all of the above: GLaBIOS is GPL-3, and FreeDOS is GPL-2-or-later
and so may be used under version 3. None of these works are modified; they are
embedded verbatim (base64) for the simulated machine to execute.
