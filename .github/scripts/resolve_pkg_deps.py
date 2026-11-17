#!/usr/bin/env python3
"""为「额外软件包」自动补齐运行时依赖，直接改写 OpenWrt 的 .config。

用法:
    resolve_pkg_deps.py <config 文件> <包名> [<包名> ...]

数据来源:
    tmp/.packageinfo    —— 由 `make prepare-tmpinfo` 生成，含每个包的 Depends
    tmp/.config-package.in —— 由 defconfig 生成，用来判断符号是否存在

行为:
    * 对每个用户指定的包，做运行时依赖闭包；
    * 闭包里凡是能在 Kconfig 找到 PACKAGE_ 符号的，都写入 CONFIG_PACKAGE_x=y；
    * 已经 =y 的跳过；写成 is not set / =m 的会被替换；
    * 输出 ADD / SKIP / INVALID 明细，供 workflow 打印。
"""
import os
import re
import sys


def parse_pkginfo(path):
    deps = {}
    provides = {}
    for block in open(path, encoding="utf-8", errors="replace").read().split("\n\n"):
        name = None
        d = []
        prov = []
        for line in block.split("\n"):
            if line.startswith("Package: "):
                name = line[9:].strip()
            elif line.startswith("Depends: "):
                for tok in re.split(r"[\s,]+", line[9:].strip()):
                    tok = tok.strip().lstrip("+")
                    if not tok:
                        continue
                    if ":" in tok:            # 形如 IPV6:ip6tables 的条件依赖，取包名
                        tok = tok.split(":", 1)[1]
                    tok = re.sub(r"\s*\(.*?\)$", "", tok).strip()
                    if not tok or tok.startswith("@"):   # @(aarch64||...) 之类的架构条件
                        continue
                    d.append(tok)
            elif line.startswith("Provides: "):
                prov = [p.strip() for p in line[10:].split(",") if p.strip()]
        if name:
            deps[name] = d
            for p in prov:
                provides.setdefault(p.lstrip("@"), []).append(name)
    return deps, provides


def parse_symbols(path):
    syms = set()
    for line in open(path, encoding="utf-8", errors="replace"):
        m = re.match(r"\s*(?:menu)?config (PACKAGE_\S+)\s*$", line)
        if m:
            syms.add(m.group(1)[len("PACKAGE_"):])
    return syms


def parse_config(path):
    """返回 (已=y 的包集合, 行列表)"""
    enabled = set()
    lines = []
    for line in open(path, encoding="utf-8", errors="replace"):
        s = line.rstrip("\n")
        lines.append(s)
        if s.startswith("CONFIG_PACKAGE_") and s.endswith("=y"):
            enabled.add(s[len("CONFIG_PACKAGE_"):-2])
    return enabled, lines


def main():
    if len(sys.argv) < 3:
        print("用法: resolve_pkg_deps.py <config> <pkg> [pkg...]")
        return 2
    cfg = sys.argv[1]
    wanted = sys.argv[2:]

    info = "tmp/.packageinfo"
    symfile = "tmp/.config-package.in"
    for f in (info, symfile):
        if not os.path.exists(f) or os.path.getsize(f) == 0:
            print("::error::%s 不存在或为空，请先运行 make prepare-tmpinfo" % f)
            return 1

    deps, provides = parse_pkginfo(info)
    symbols = parse_symbols(symfile)
    enabled, lines = parse_config(cfg)

    def resolve(n):
        if n in deps:
            return n
        cand = provides.get(n)
        return cand[0] if cand else None

    invalid = []
    roots = []
    for p in wanted:
        if p in symbols:
            roots.append(p)
        else:
            invalid.append(p)

    # 依赖闭包（记录来源，便于打印）
    origin = {}
    queue = [(p, p) for p in roots]
    seen = set()
    order = []
    while queue:
        name, frm = queue.pop(0)
        real = resolve(name)
        if not real or real in seen:
            continue
        seen.add(real)
        order.append(real)
        origin[real] = frm
        for d in deps.get(real, []):
            r = resolve(d)
            if r and r not in seen:
                queue.append((r, real))

    added, skipped, nostat = 0, 0, []
    for name in order:
        if name not in symbols:
            nostat.append(name)          # 纯虚拟包/元包，没有独立 Kconfig 符号
            continue
        if name in enabled:
            skipped += 1
            continue
        # 先清掉该符号的旧行（is not set / =m），再追加 =y
        sym = "CONFIG_PACKAGE_" + name
        kept = [l for l in lines if not (
            l == sym + "=y" or l == "# " + sym + " is not set" or l == sym + "=m" or l == "# " + sym + "=m")]
        kept.append(sym + "=y")
        lines = kept
        enabled.add(name)
        added += 1
        if name in roots:
            print("ADD %-42s (用户指定)" % name)
        else:
            print("ADD %-42s (依赖 %s)" % (name, origin.get(name, "?")))

    with open(cfg, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    for p in invalid:
        print("::warning::忽略 %s：不是有效的软件包名" % p)
    if nostat:
        print("INFO 以下依赖无独立包符号（虚拟包），已跳过：%s" % ", ".join(sorted(set(nostat))))
    print("依赖补齐完成：新增 %d，已启用 %d，无效 %d" % (added, skipped, len(invalid)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
