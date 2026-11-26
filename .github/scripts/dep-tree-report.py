#!/usr/bin/env python3
"""检查单个软件包的依赖情况，与 defconfig 后的 .config 比对，输出 GitHub Job Summary。

用法: dep-tree-report.py <package> <config> <packageinfo>

数据来源:
    tmp/.packageinfo  —— Depends / Version / Provides 元数据
    .config           —— make defconfig 之后的完整配置（含所有 PACKAGE_ 符号）

行为:
    * 递归展开目标包的依赖树
    * 条件依赖 COND:pkg —— COND 在 .config 里为 y/m 才纳入，否则跳过（方案 A）
    * 虚拟包 —— 按 Provides 解析到实际提供者
    * 每个节点标注状态: 已选(=y) / 未选(is not set 或缺失)
    * 写入 $GITHUB_STEP_SUMMARY（GitHub Actions 页面直接渲染）
"""
import os
import re
import sys


def parse_pkginfo(path):
    """返回 deps/version/provides"""
    deps, versions, provides = {}, {}, {}
    for block in open(path, encoding="utf-8", errors="replace").read().split("\n\n"):
        name = None
        dl = []
        prov = []
        for line in block.split("\n"):
            if line.startswith("Package: "):
                name = line[9:].strip()
            elif line.startswith("Version: "):
                if name:
                    versions[name] = line[9:].strip()
            elif line.startswith("Depends: "):
                for tok in re.split(r"[\s,]+", line[9:].strip()):
                    tok = tok.strip().lstrip("+")
                    if not tok:
                        continue
                    cond = None
                    if ":" in tok:
                        cond, tok = tok.split(":", 1)
                    tok = re.sub(r"\s*\(.*?\)$", "", tok).strip()
                    if not tok or tok.startswith("@"):
                        continue
                    dl.append((cond, tok))
            elif line.startswith("Provides: "):
                prov = [p.strip().lstrip("@") for p in re.split(r"[\s,]+", line[10:].strip()) if p.strip()]
        if name:
            deps[name] = dl
            versions.setdefault(name, "")
            for p in prov:
                provides.setdefault(p, []).append(name)
    return deps, versions, provides


def parse_config(path):
    """返回 {符号名: y/n/m}"""
    values = {}
    for line in open(path, encoding="utf-8", errors="replace"):
        s = line.rstrip("\n")
        m = re.match(r"^CONFIG_([A-Za-z0-9_.-]+)=(.*)$", s)
        if m:
            values[m.group(1)] = m.group(2)
        elif s.startswith("# CONFIG_") and s.endswith(" is not set"):
            values[s[len("# CONFIG_"):-len(" is not set")]] = "n"
    return values


def main():
    if len(sys.argv) < 4:
        print("用法: dep-tree-report.py <package> <config> <packageinfo>", file=sys.stderr)
        return 2
    root, cfgpath, infopath = sys.argv[1], sys.argv[2], sys.argv[3]

    deps, versions, provides = parse_pkginfo(infopath)
    values = parse_config(cfgpath)

    def resolve(name):
        if name in deps:
            return name
        cand = provides.get(name)
        return cand[0] if cand else None

    def cond_ok(cond):
        if not cond:
            return True
        neg = cond.startswith("!")
        key = cond[1:] if neg else cond
        v = values.get(key, "n")
        on = v in ("y", "m")
        return (not on) if neg else on

    def status(name):
        v = values.get("PACKAGE_" + name, "missing")
        if v == "y":
            return "y"
        if v == "m":
            return "m"
        return "n"

    # 校验根包
    real_root = resolve(root)
    if not real_root:
        print("::error::包 %s 在 feeds 中不存在" % root, file=sys.stderr)
        return 1

    # 构造依赖树（BFS，记录子节点；避免循环）
    children = {}
    queue = [(real_root, 0)]
    seen = set()
    while queue:
        name, _ = queue.pop(0)
        if name in seen:
            continue
        seen.add(name)
        kids = []
        for cond, dep in deps.get(name, []):
            if not cond_ok(cond):
                continue
            real = resolve(dep)
            if real and real not in seen:
                kids.append(real)
                queue.append((real, 0))
        children[name] = kids

    # 渲染 Markdown（GitHub Summary）
    out = []
    out.append("## 软件包依赖检查报告\n")
    out.append("| 项目 | 值 |")
    out.append("|---|---|")
    out.append("| 软件包 | `%s` |" % root)
    out.append("| 版本 | `%s` |" % (versions.get(real_root, "") or "未知"))
    out.append("| 依赖节点数 | %d |" % len(seen))
    sel = sum(1 for n in seen if status(n) == "y")
    miss = len(seen) - sel
    out.append("| 状态统计 | 已选 %d / 未选 %d |" % (sel, miss))
    out.append("")
    out.append("> 基于 **defconfig 之后** 的 `.config` 判定：`=y` 为已选，`is not set` 或缺失为未选。")
    out.append("> 条件依赖仅在条件符号为 y/m 时纳入；虚拟包按 Provides 解析到实际提供者。\n")
    out.append("### 依赖树\n")
    out.append("```text")

    def render(name, prefix, is_last, depth):
        st = status(name)
        label = "[已选]" if st == "y" else ("[模块]" if st == "m" else "[未选]")
        connector = "└─ " if is_last else "├─ "
        out.append(prefix + connector + name + "  " + label)
        kids = children.get(name, [])
        child_prefix = prefix + ("   " if is_last else "│  ")
        for i, k in enumerate(kids):
            render(k, child_prefix, i == len(kids) - 1, depth + 1)

    render(real_root, "", True, 0)
    out.append("```")
    out.append("")
    out.append("---")
    out.append("图例：`[已选]` = `CONFIG_PACKAGE_x=y`；`[未选]` = `is not set` 或 config 中缺失。")

    text = "\n".join(out) + "\n"

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(text)
        print("已写入 GitHub Step Summary: %s" % summary)
    else:
        print(text)

    # 同时打印到日志，便于在 Actions log 里直接看
    print("\n===== 依赖检查报告 =====\n")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
