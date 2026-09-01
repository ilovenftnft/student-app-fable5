import os, sys, json, struct, subprocess, concurrent.futures as cf

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"
OUT = "/Users/wyz/Projects/student-app/textbook"

def get(url, rng=None):
    """Download via curl: this environment has a TLS-intercepting proxy whose root
    is in the system keychain (curl trusts it) but not in Python's CA bundle."""
    cmd = ["curl", "-sSf", "--max-time", "120", "-A", UA]
    if rng: cmd += ["-r", rng]
    cmd.append(url)
    p = subprocess.run(cmd, capture_output=True)
    if p.returncode != 0:
        raise IOError(p.stderr.decode()[:120])
    return p.stdout

def exists(base, n):
    try:
        get(f"{base}/{n}.jpg", rng="0-64"); return True
    except Exception:
        return False

def page_count(base):
    lo, hi = 1, 2
    while exists(base, hi) and hi < 4096:
        lo, hi = hi, hi * 2
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if exists(base, mid): lo = mid
        else: hi = mid
    return lo

def jpeg_info(b):
    """returns (width, height, ncomp) from SOF marker"""
    i = 2
    while i < len(b) - 9:
        if b[i] != 0xFF: i += 1; continue
        m = b[i+1]
        if m in (0xD8, 0xD9) or 0xD0 <= m <= 0xD7: i += 2; continue
        seglen = struct.unpack(">H", b[i+2:i+4])[0]
        if m in (0xC0,0xC1,0xC2,0xC3,0xC5,0xC6,0xC7,0xC9,0xCA,0xCB,0xCD,0xCE,0xCF):
            h, w = struct.unpack(">HH", b[i+5:i+9])
            ncomp = b[i+9]
            return w, h, ncomp
        i += 2 + seglen
    raise ValueError("no SOF marker")

def build_pdf(jpegs, path, dpi=180):
    """Embed JPEGs losslessly via DCTDecode."""
    objs = [None]                      # 1-indexed
    def add(data): objs.append(data); return len(objs) - 1
    page_ids, kids = [], []
    pages_id = add(b"")                # placeholder, fill later
    for jb in jpegs:
        w, h, nc = jpeg_info(jb)
        cs = {1: b"/DeviceGray", 3: b"/DeviceRGB", 4: b"/DeviceCMYK"}[nc]
        img_id = add(
            b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace %s "
            b"/BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n" % (w, h, cs, len(jb))
            + jb + b"\nendstream")
        pw, ph = w * 72.0 / dpi, h * 72.0 / dpi
        content = b"q %.2f 0 0 %.2f 0 0 cm /Im0 Do Q" % (pw, ph)
        cont_id = add(b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream")
        pid = add(b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %.2f %.2f] "
                  b"/Resources << /XObject << /Im0 %d 0 R >> >> /Contents %d 0 R >>"
                  % (pages_id, pw, ph, img_id, cont_id))
        page_ids.append(pid)
    objs[pages_id] = (b"<< /Type /Pages /Count %d /Kids [%s] >>"
                      % (len(page_ids), b" ".join(b"%d 0 R" % p for p in page_ids)))
    root_id = add(b"<< /Type /Catalog /Pages %d 0 R >>" % pages_id)

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offs = [0] * len(objs)
    for i in range(1, len(objs)):
        offs[i] = len(out)
        out += b"%d 0 obj\n" % i + objs[i] + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n" % len(objs) + b"0000000000 65535 f \n"
    for i in range(1, len(objs)):
        out += b"%010d 00000 n \n" % offs[i]
    out += (b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n"
            % (len(objs), root_id, xref))
    open(path, "wb").write(bytes(out))

def main():
    targets = json.load(open(os.path.join(os.path.dirname(__file__), "targets2.json")))
    for name, base in targets.items():
        dest = os.path.join(OUT, name + ".pdf")
        if os.path.exists(dest):
            print(f"跳过（已存在）: {name}"); continue
        n = page_count(base)
        print(f"{name}: {n} 页，下载中…", flush=True)
        pages = [None] * n
        def fetch(k):
            for _ in range(4):
                try: return k, get(f"{base}/{k+1}.jpg")
                except Exception: pass
            return k, None
        with cf.ThreadPoolExecutor(8) as ex:
            for k, data in ex.map(fetch, range(n)):
                pages[k] = data
        missing = [i+1 for i, p in enumerate(pages) if p is None]
        if missing:
            print(f"  ⚠ 缺页 {missing[:10]}（共{len(missing)}页），跳过"); continue
        build_pdf(pages, dest)
        mb = os.path.getsize(dest) / 1048576
        w, h, _ = jpeg_info(pages[len(pages)//2])
        print(f"  ✓ {dest}  {mb:.1f}MB  中页尺寸 {w}×{h}")

main()
