#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build_booklet.py — 把 docs/delivery/review 的 6 份说明文档 + 29 张图片合成《提审材料册（合订本）》。

用法（在仓库根目录）：
    "D:/AISI/dsh-data/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/python.exe" \
        tools/build_booklet.py

输出（写入 docs/delivery/review/）：
    提审材料册（合订本）.docx / 提审材料册（合订本）.pdf

依赖：python-docx、Pillow（随 DSH 运行时提供）；PDF 转换用 LibreOffice Kit CLI。
纪律：只读 00~05 文档与 images/，不修改任何源文件；真实值一律留划线空白（＿＿），不写入本册。
"""

import re
import subprocess
import sys
import tempfile
from pathlib import Path

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_TAB_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
HERE = ROOT / "docs" / "delivery" / "review"
BODY = "Microsoft YaHei"
MONO = "Consolas"
NAVY = RGBColor(0x1F, 0x38, 0x64)
BLUE = RGBColor(0x2E, 0x54, 0x96)
GRAY = RGBColor(0x59, 0x59, 0x59)
LIGHT = RGBColor(0x7F, 0x7F, 0x7F)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
W = 16.4  # 正文可用宽度 cm
H = 25.5  # 正文可用高度 cm

CHAPTERS = [
    ("第一部分　材料索引", "00_材料包总览与使用顺序.md",
     "材料清单、使用顺序、提审页速查、待办事项"),
    ("第二部分　提审文案与审核说明", "01_提审文案（可直接粘贴）.md",
     "提审页字段速查、版本描述、完整/精简审核说明、隐私与第三方说明、零金额口径、加急理由"),
    ("第三部分　截图清单与图注", "02_审核截图清单与图注.md",
     "25 张真实页面截图 + 4 张示意图的文件名、页面路径、画面要点与图注（图片逐张附在本表之后）"),
    ("第四部分　隐私声明对照表", "03_隐私声明对照表.md",
     "后台声明项 ↔ 代码调用点 ↔ 端内文本条款；DeepSeek 披露；三处同源对照"),
    ("第五部分　类目备案与业务说明", "04_类目备案与业务说明.md",
     "类目口径与备选顺序、备案要点、32 页功能清单、不涉及交易论证、审核追问答复"),
    ("第六部分　提审操作步骤与证据归档", "05_提审操作步骤与证据归档.md",
     "提审前检查表、公众平台逐步操作、驳回处理、发布、证据表、审核后清理"),
]

MODE = "full"  # full=六份文档全量；external=审核员可读的精选章（供 build_external.py 复用）


# ----------------------------------------------------------------- 基础排版工具
def set_run_font(run, size=None, bold=None, color=None, font=BODY, italic=None):
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if italic is not None:
        run.italic = italic
    if color is not None:
        run.font.color.rgb = color
    run.font.name = font
    rpr = run._element.get_or_add_rPr()
    rf = rpr.find(qn("w:rFonts"))
    if rf is None:
        rf = OxmlElement("w:rFonts")
        rpr.append(rf)
    for attr in ("w:ascii", "w:hAnsi", "w:eastAsia"):
        rf.set(qn(attr), font)


def set_style_font(style, size, bold, color=None):
    style.font.size = Pt(size)
    style.font.bold = bold
    style.font.name = BODY
    if color is not None:
        style.font.color.rgb = color
    rpr = style.element.find(qn("w:rPr"))
    if rpr is not None:
        rf = rpr.find(qn("w:rFonts"))
        if rf is None:
            rf = OxmlElement("w:rFonts")
            rpr.append(rf)
        for attr in ("w:ascii", "w:hAnsi", "w:eastAsia"):
            rf.set(qn(attr), BODY)


def shade(cell, hex_color):
    tcpr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_color)
    tcpr.append(shd)


def cell_margins(table, top=40, bottom=40, left=72, right=72):
    tblpr = table._tbl.tblPr
    mar = OxmlElement("w:tblCellMar")
    for name, val in (("top", top), ("left", left), ("bottom", bottom), ("right", right)):
        el = OxmlElement("w:" + name)
        el.set(qn("w:w"), str(val))
        el.set(qn("w:type"), "dxa")
        mar.append(el)
    tblpr.append(mar)


def table_borders(table, color="B4C6E7", size=4, sides="all"):
    tblpr = table._tbl.tblPr
    borders = OxmlElement("w:tblBorders")
    names = ("top", "left", "bottom", "right", "insideH", "insideV")
    for name in names:
        el = OxmlElement("w:" + name)
        if sides == "all" or name == sides:
            el.set(qn("w:val"), "single")
            el.set(qn("w:sz"), str(size))
            el.set(qn("w:space"), "0")
            el.set(qn("w:color"), color)
        else:
            el.set(qn("w:val"), "nil")
        borders.append(el)
    tblpr.append(borders)


def fixed_layout(table):
    tblpr = table._tbl.tblPr
    layout = OxmlElement("w:tblLayout")
    layout.set(qn("w:type"), "fixed")
    tblpr.append(layout)


def add_field(par, instr, size=8.5):
    fld = OxmlElement("w:fldSimple")
    fld.set(qn("w:instr"), instr)
    r = OxmlElement("w:r")
    rpr = OxmlElement("w:rPr")
    sz = OxmlElement("w:sz")
    sz.set(qn("w:val"), str(int(size * 2)))
    rpr.append(sz)
    r.append(rpr)
    t = OxmlElement("w:t")
    t.text = "1"
    r.append(t)
    fld.append(r)
    par._p.append(fld)


def para_border(par, side="bottom", color="1F3864", size=8):
    ppr = par._p.get_or_add_pPr()
    bdr = ppr.find(qn("w:pBdr"))
    if bdr is None:
        bdr = OxmlElement("w:pBdr")
        ppr.append(bdr)
    el = OxmlElement("w:" + side)
    el.set(qn("w:val"), "single")
    el.set(qn("w:sz"), str(size))
    el.set(qn("w:space"), "4")
    el.set(qn("w:color"), color)
    bdr.append(el)


TOKEN = re.compile(r"(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\{\{[^}]+\}\})")


def add_inline(par, text, size=10.5, bold=False, color=None, font=BODY):
    pos = 0
    for m in TOKEN.finditer(text):
        if m.start() > pos:
            r = par.add_run(text[pos:m.start()])
            set_run_font(r, size, bold, color, font)
        tok = m.group(0)
        if tok.startswith("**"):
            add_inline(par, tok[2:-2], size, True, color, font)
        elif tok.startswith("`"):
            r = par.add_run(tok[1:-1])
            set_run_font(r, size - 0.5, bold, BLUE, MONO)
        elif tok.startswith("["):
            label = tok[1:tok.index("]")]
            r = par.add_run(label)
            set_run_font(r, size, bold, color or BLUE, font)
        else:
            inner = tok[2:-2]
            r = par.add_run("＿" * min(12, max(6, len(inner) * 2)))
            set_run_font(r, size, bold, RGBColor(0x33, 0x33, 0x33), font)
        pos = m.end()
    if pos < len(text):
        r = par.add_run(text[pos:])
        set_run_font(r, size, bold, color, font)


def add_para(doc, text, size=10.5, color=None, space_before=0, space_after=3.5,
             indent=0.0, line=1.28, align=None, bold=False):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.space_before = Pt(space_before)
    pf.space_after = Pt(space_after)
    pf.line_spacing = line
    if indent:
        pf.left_indent = Cm(indent)
    if align is not None:
        p.alignment = align
    add_inline(p, text, size, bold=bold, color=color)
    return p


def add_heading(doc, text, level):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    if level == 2:
        pf.space_before, pf.space_after = Pt(13), Pt(5)
        size, color = 14, BLUE
    elif level == 3:
        pf.space_before, pf.space_after = Pt(10), Pt(3)
        size, color = 12, NAVY
    else:
        pf.space_before, pf.space_after = Pt(8), Pt(2)
        size, color = 10.5, RGBColor(0x33, 0x33, 0x33)
    pf.keep_with_next = True
    add_inline(p, text, size, bold=True, color=color)
    if level == 2:
        para_border(p, "bottom", "D6E0F0", 3)
    return p


def add_note(doc, lines):
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    fixed_layout(table)
    table_borders(table, "C9D6E8", 4)
    cell = table.cell(0, 0)
    shade(cell, "F3F6FB")
    cell_margins(table, 60, 60, 96, 96)
    cell.width = Cm(W)
    table.columns[0].width = Cm(W)
    first = True
    for line in lines:
        p = cell.paragraphs[0] if first else cell.add_paragraph()
        first = False
        pf = p.paragraph_format
        pf.space_before = Pt(0)
        pf.space_after = Pt(1.5)
        pf.line_spacing = 1.2
        add_inline(p, line, 9.5, color=GRAY)
    add_para(doc, "", size=4, space_after=2)


def add_code(doc, lines, lang):
    font = MONO if lang in ("bash", "json", "js", "text-cmd") else BODY
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    fixed_layout(table)
    table_borders(table, "D9D9D9", 4)
    cell = table.cell(0, 0)
    shade(cell, "F6F7F8")
    cell_margins(table, 70, 70, 110, 110)
    cell.width = Cm(W)
    table.columns[0].width = Cm(W)
    first = True
    for line in lines:
        p = cell.paragraphs[0] if first else cell.add_paragraph()
        first = False
        pf = p.paragraph_format
        pf.space_before = Pt(0)
        pf.space_after = Pt(0)
        pf.line_spacing = 1.18
        r = p.add_run(line if line else " ")
        set_run_font(r, 9, False, RGBColor(0x26, 0x26, 0x26), font)
    add_para(doc, "", size=4, space_after=3)


def add_list(doc, items, ordered):
    counters = {}
    for idx, item in enumerate(items):
        if ordered:
            level, num, text = item
        else:
            level, text = item
            num = None
        level = min(2, level // 2)
        p = doc.add_paragraph()
        pf = p.paragraph_format
        pf.space_before = Pt(0)
        pf.space_after = Pt(2)
        pf.line_spacing = 1.24
        pf.left_indent = Cm(0.55 + 0.75 * level)
        pf.first_line_indent = Cm(-0.55)
        if ordered:
            cur = counters.get(level, 0) + 1
            counters[level] = cur
            for deeper in [k for k in counters if k > level]:
                counters.pop(deeper)
            prefix = "%d. " % cur
        else:
            prefix = "· "
        r = p.add_run(prefix)
        set_run_font(r, 10.5, False, BLUE if ordered else GRAY, BODY)
        add_inline(p, text, 10.5)


def col_widths(header, rows):
    n = len(header)
    weights = []
    for i in range(n):
        vals = [len(re.sub(r"[`*＿]", "", r[i])) for r in rows if i < len(r)]
        vals.append(len(header[i]))
        vals.sort()
        med = vals[len(vals) // 2]
        weights.append(max(4.0, float(med)))
    total = sum(weights)
    widths = [W * w / total for w in weights]
    mins = []
    for i in range(n):
        if header[i].strip() == "#":
            mins.append(0.95)
        else:
            mins.append(min(3.0, max(1.55, 0.31 * len(header[i]) + 0.42)))
    widths = [max(mins[i], w) for i, w in enumerate(widths)]
    s = sum(widths)
    return [w * W / s for w in widths]


def add_table(doc, header, rows, widths=None):
    table = doc.add_table(rows=1, cols=len(header))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    fixed_layout(table)
    table_borders(table, "C9D6E8", 4)
    cell_margins(table, 34, 34, 64, 64)
    if widths is None:
        widths = col_widths(header, rows)
    else:
        s = sum(widths)
        widths = [w * W / s for w in widths]
    hdr = table.rows[0]
    trpr = hdr._tr.get_or_add_trPr()
    trpr.append(OxmlElement("w:cantSplit"))
    th = OxmlElement("w:tblHeader")
    trpr.append(th)
    fsize = 8.0 if len(header) >= 6 else 8.5
    for i, cell in enumerate(hdr.cells):
        shade(cell, "1F3864")
        p = cell.paragraphs[0]
        p.paragraph_format.space_before = Pt(1)
        p.paragraph_format.space_after = Pt(1)
        p.paragraph_format.line_spacing = 1.12
        add_inline(p, header[i], fsize, bold=True, color=WHITE)
    for ri, row in enumerate(rows):
        tr = table.add_row()
        cant = OxmlElement("w:cantSplit")
        tr._tr.get_or_add_trPr().append(cant)
        cells = tr.cells
        for ci, cell in enumerate(cells):
            text = row[ci] if ci < len(row) else ""
            if ri % 2 == 1:
                shade(cell, "F2F6FB")
            p = cell.paragraphs[0]
            p.paragraph_format.space_before = Pt(1)
            p.paragraph_format.space_after = Pt(1)
            p.paragraph_format.line_spacing = 1.14
            add_inline(p, text, fsize, color=RGBColor(0x22, 0x22, 0x22))
    for ci, w in enumerate(widths):
        table.columns[ci].width = Cm(w)
        for row in table.rows:
            row.cells[ci].width = Cm(w)
    add_para(doc, "", size=4, space_after=2.5)
    return table


# ----------------------------------------------------------------- Markdown 解析
def read_md(name):
    return (HERE / name).read_text(encoding="utf-8")


def parse_blocks(text):
    lines = text.split("\n")
    blocks = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("```"):
            lang = line[3:].strip()
            buf = []
            i += 1
            while i < len(lines) and not lines[i].startswith("```"):
                buf.append(lines[i])
                i += 1
            blocks.append(("code", buf, lang))
            i += 1
            continue
        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            blocks.append(("h", len(m.group(1)), m.group(2).strip()))
            i += 1
            continue
        if line.strip() in ("---", "***"):
            i += 1
            continue
        if line.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                rows.append(lines[i])
                i += 1
            blocks.append(("table", rows))
            continue
        if re.match(r"^\s*>", line):
            buf = []
            while i < len(lines) and re.match(r"^\s*>", lines[i]):
                buf.append(re.sub(r"^\s*>\s?", "", lines[i]).strip())
                i += 1
            blocks.append(("quote", buf))
            continue
        m = re.match(r"^(\s*)[-*]\s+(.*)$", line)
        if m:
            items = []
            while i < len(lines):
                mm = re.match(r"^(\s*)[-*]\s+(.*)$", lines[i])
                if not mm:
                    break
                items.append((len(mm.group(1)), mm.group(2).strip()))
                i += 1
            blocks.append(("ul", items))
            continue
        m = re.match(r"^(\s*)(\d+)\.\s+(.*)$", line)
        if m:
            items = []
            while i < len(lines):
                mm = re.match(r"^(\s*)(\d+)\.\s+(.*)$", lines[i])
                if not mm:
                    break
                items.append((len(mm.group(1)), int(mm.group(2)), mm.group(3).strip()))
                i += 1
            blocks.append(("ol", items))
            continue
        if line.strip() == "":
            i += 1
            continue
        blocks.append(("p", line.strip()))
        i += 1
    return blocks


def split_table(rows):
    header = [c.strip() for c in rows[0].strip().strip("|").split("|")]
    body = []
    for raw in rows[1:]:
        cells = [c.strip() for c in raw.strip().strip("|").split("|")]
        if cells and all(re.match(r"^:?-{1,}:?$", c) for c in cells if c):
            continue
        body.append(cells)
    n = len(header)
    for r in body:
        while len(r) < n:
            r.append("")
    return header, body


# ----------------------------------------------------------------- 图片处理
def prepare_image(src, tmpdir):
    """截图转 JPEG（控制体积），示意图保留 PNG；返回可用路径。"""
    src = Path(src)
    if src.parent.name == "screenshots":
        out = Path(tmpdir) / (src.stem + ".jpg")
        with Image.open(src) as im:
            im.convert("RGB").save(out, "JPEG", quality=88, optimize=True)
        return out, True
    return src, False


def table_no_borders(table):
    tblpr = table._tbl.tblPr
    borders = OxmlElement("w:tblBorders")
    for name in ("top", "left", "bottom", "right", "insideH", "insideV"):
        el = OxmlElement("w:" + name)
        el.set(qn("w:val"), "nil")
        borders.append(el)
    tblpr.append(borders)


def add_figure(doc, img_path, label, caption, page_break_first=True):
    with Image.open(img_path) as im:
        w, h = im.size
    if page_break_first:
        page_break(doc)
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    fixed_layout(table)
    table_no_borders(table)
    cell_margins(table, 0, 0, 0, 0)
    cant = OxmlElement("w:cantSplit")
    table.rows[0]._tr.get_or_add_trPr().append(cant)
    cell = table.cell(0, 0)
    cell.width = Cm(W)
    table.columns[0].width = Cm(W)
    p = cell.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(5)
    p.paragraph_format.line_spacing = 1.0
    if h > w:
        p.add_run().add_picture(str(img_path), height=Cm(21.2))
    else:
        width = min(W, 15.8)
        if width * h / w > 19.0:
            width = 19.0 * w / h
        p.add_run().add_picture(str(img_path), width=Cm(width))
    cp = cell.add_paragraph()
    cp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    cp.paragraph_format.space_before = Pt(0)
    cp.paragraph_format.space_after = Pt(4)
    cp.paragraph_format.line_spacing = 1.25
    r = cp.add_run(label + "　")
    set_run_font(r, 9.5, True, NAVY)
    r2 = cp.add_run(caption)
    set_run_font(r2, 9.0, False, GRAY)


def render_blocks(doc, blocks, chapter_no, embed_images, tmpdir):
    fig_no = 0
    for b in blocks:
        kind = b[0]
        if kind == "h":
            if b[1] == 1:
                continue
            add_heading(doc, b[2], min(4, b[1]))
        elif kind == "p":
            add_para(doc, b[1])
        elif kind == "quote":
            add_note(doc, b[1])
        elif kind == "code":
            add_code(doc, b[1], b[2])
        elif kind == "ul":
            add_list(doc, b[1], False)
        elif kind == "ol":
            add_list(doc, b[1], True)
        elif kind == "table":
            header, rows = split_table(b[1])
            add_table(doc, header, rows)
            if not embed_images:
                continue
            try:
                fi = header.index("文件名") if "文件名" in header else (
                    [i for i, h in enumerate(header) if "文件名" in h][0])
                ci = [i for i, h in enumerate(header) if "图注" in h]
                if not ci:
                    continue
                ci = ci[0]
            except (ValueError, IndexError):
                continue
            for row in rows:
                if fi >= len(row):
                    continue
                fname = re.sub(r"[`]", "", row[fi])
                path = None
                for sub in ("screenshots", "diagrams"):
                    cand = HERE / "images" / sub / fname
                    if cand.is_file():
                        path = cand
                        break
                if path is None:
                    print("  [WARN] 图片缺失：%s" % fname)
                    continue
                fig_no += 1
                use, _ = prepare_image(path, tmpdir)
                add_figure(doc, use, "图 %d-%02d　%s" % (chapter_no, fig_no, path.stem),
                           row[ci] if ci < len(row) else "")
    return fig_no


# ----------------------------------------------------------------- 版式骨架
def setup_document():
    doc = Document()
    sec = doc.sections[0]
    sec.page_width, sec.page_height = Cm(21.0), Cm(29.7)
    sec.top_margin, sec.bottom_margin = Cm(2.2), Cm(2.0)
    sec.left_margin, sec.right_margin = Cm(2.3), Cm(2.3)
    sec.header_distance, sec.footer_distance = Cm(1.0), Cm(0.9)
    sec.different_first_page_header_footer = True
    normal = doc.styles["Normal"]
    set_style_font(normal, 10.5, False)
    normal.paragraph_format.line_spacing = 1.28
    normal.paragraph_format.space_after = Pt(3.5)

    hdr = sec.header.paragraphs[0]
    hdr.paragraph_format.tab_stops.add_tab_stop(Cm(W), WD_TAB_ALIGNMENT.RIGHT)
    r = hdr.add_run("微信小程序提审材料册（合订本）")
    set_run_font(r, 8.5, False, LIGHT)
    r = hdr.add_run("\t批 22 · 2026-11-01")
    set_run_font(r, 8.5, False, LIGHT)
    para_border(hdr, "bottom", "C9D6E8", 4)

    ftr = sec.footer.paragraphs[0]
    ftr.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = ftr.add_run("第 ")
    set_run_font(r, 8.5, False, LIGHT)
    add_field(ftr, "PAGE")
    r = ftr.add_run(" 页 / 共 ")
    set_run_font(r, 8.5, False, LIGHT)
    add_field(ftr, "NUMPAGES")
    r = ftr.add_run(" 页")
    set_run_font(r, 8.5, False, LIGHT)
    return doc


def page_break(doc):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(0)
    p.paragraph_format.line_spacing = 1.0
    p.add_run().add_break(WD_BREAK.PAGE)


def cover(doc):
    for _ in range(5):
        add_para(doc, "", size=11, space_after=0)
    p = add_para(doc, "微信小程序 · 提审补充材料", size=12, color=BLUE,
                 align=WD_ALIGN_PARAGRAPH.CENTER, space_after=10)
    p = add_para(doc, "提审材料册", size=34, color=NAVY, bold=True,
                 align=WD_ALIGN_PARAGRAPH.CENTER, space_after=4)
    add_para(doc, "合订本 · 6 份说明文档 + 29 张图片", size=13, color=GRAY,
             align=WD_ALIGN_PARAGRAPH.CENTER, space_after=2)
    add_para(doc, "校园快递代取信息与履约工具（零金额口径 · 不涉及任何金钱交易）", size=10.5,
             color=GRAY, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=26)
    info = [
        ("小程序名称", "＿" * 10),
        ("体验版本", "＿" * 7),
        ("审核体验邀请码", "＿" * 8),
        ("联系方式（邮箱为主）", "＿" * 12),
        ("备案号", "＿" * 10),
        ("编制", "批 22（2026-11-01）"),
        ("材料来源", "docs/delivery/review/（00~05 + images/）"),
    ]
    table = doc.add_table(rows=0, cols=2)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    fixed_layout(table)
    for label, value in info:
        cells = table.add_row().cells
        cells[0].width, cells[1].width = Cm(5.4), Cm(11.0)
        table.columns[0].width, table.columns[1].width = Cm(5.4), Cm(11.0)
        p0 = cells[0].paragraphs[0]
        p0.paragraph_format.space_before = Pt(2.5)
        p0.paragraph_format.space_after = Pt(2.5)
        r = p0.add_run(label)
        set_run_font(r, 10.5, True, NAVY)
        p1 = cells[1].paragraphs[0]
        p1.paragraph_format.space_before = Pt(2.5)
        p1.paragraph_format.space_after = Pt(2.5)
        if "＿" in value:
            para_border(p1, "bottom", "8EA9DB", 6)
        r = p1.add_run(value)
        set_run_font(r, 10.5, False, RGBColor(0x22, 0x22, 0x22))
    for _ in range(4):
        add_para(doc, "", size=10, space_after=0)
    add_para(doc, "本册由脚本 build_booklet.py 从 6 份说明文档与 29 张图片自动合成；"
                  "文中划线空白（＿＿）为待填真实值，提交前请填写。真实值不进仓库。",
             size=9, color=LIGHT, align=WD_ALIGN_PARAGRAPH.CENTER)


def usage_page(doc):
    page_break(doc)
    add_para(doc, "使用说明", size=18, color=NAVY, space_after=12)
    para_border(doc.paragraphs[-1], "bottom", "D6E0F0", 6)
    add_para(doc, "本册把 docs/delivery/review/ 下的 6 份说明文档与 29 张图片合成一册，"
                  "用于通读、归档，或作为补充材料一次性提交（提交前按平台附件格式与大小上限确认）。",
             space_after=7)
    add_para(doc, "结构", size=12, color=BLUE, space_before=4, space_after=4)
    add_para(doc, "第一至第六部分依次对应 00~05 六份说明文档；第三部分的 25 张真实页面截图与 4 张示意图"
                  "逐张附在图注表之后（每页 1 张），图注即补充材料里可直接粘贴的文字。", space_after=7)
    add_para(doc, "提交前必须填写（本册划线空白处）", size=12, color=BLUE, space_before=4, space_after=4)
    add_para(doc, "① 对外名称　② 联系方式（邮箱为主）　③ 版本号　④ 审核体验邀请码　⑤ 备案号。", space_after=3)
    add_para(doc, "说明文档中灰底代码块是可直接粘贴的底稿，其中的 {{…}} 同样是待填项；替换后粘贴即可。",
             space_after=3)
    add_para(doc, "其余需你本人完成、agent 不代做的事项（见第一部分 §5 与第三部分 §7）："
                  "微信后台《用户隐私保护指引》逐项声明截图；类目与备案页截图；三段真机录屏；"
                  "身份选择页截图（普通微信号真机补拍）；加急额度确认；审核后清理记录。", space_after=7)
    add_para(doc, "图片说明", size=12, color=BLUE, space_before=4, space_after=4)
    add_para(doc, "以下截图为内部测试账号的界面演示，顶部蓝条与右上角 TEST 角标是内部测试标记，"
                  "正式用户界面不出现；截图中账号、订单、取件码、宿舍均为测试数据，不含真实用户资料。"
                  "示意图只作解释，不代表真机截图。", space_after=7)
    add_para(doc, "口径与纪律", size=12, color=BLUE, space_before=4, space_after=4)
    add_para(doc, "本册不新增产品承诺、不扩展服务范围，口径冲突以 docs/contract/V4_CONTRACT.md 为准；"
                  "本册只准备材料，不代提审、不代填真实值、不代勾后台选项、不发布。", space_after=7)
    add_para(doc, "维护", size=12, color=BLUE, space_before=4, space_after=4)
    add_para(doc, "材料变化后重跑 build_booklet.py 重新生成；源文档改动与图片重出以 docs/delivery/review/ 内文件为准。")


def toc_page(doc):
    page_break(doc)
    add_para(doc, "目录", size=18, color=NAVY, space_after=10)
    para_border(doc.paragraphs[-1], "bottom", "D6E0F0", 6)
    add_para(doc, "使用说明", size=10.5, bold=True)
    header = ["部分", "内容", "来源文件"]
    rows = [["使用说明", "本册用途、待填项、图片说明、口径纪律", "—"]]
    for idx, (title, fname, desc) in enumerate(CHAPTERS, 1):
        head = title.split("　")[0]
        rows.append([head, desc, fname])
    add_table(doc, header, rows, widths=[2.0, 8.2, 6.2])
    add_para(doc, "注：本册封面与使用说明为合成说明，其余内容逐字取自 00~05 六份说明文档；"
                  "第三部分含 29 张图片页（每页 1 张，图注取自第三部分各表）。",
             size=9, color=GRAY)


def chapter(doc, no, title, fname, desc, embed):
    page_break(doc)
    p = add_para(doc, title, size=19, color=NAVY, space_after=3)
    para_border(p, "bottom", "1F3864", 8)
    add_para(doc, "来源文件：" + fname + "　·　" + desc, size=9, color=GRAY, space_after=8)
    blocks = parse_blocks(read_md(fname))
    return render_blocks(doc, blocks, no, embed, TMPDIR)


def main():
    global TMPDIR
    TMPDIR = tempfile.mkdtemp(prefix="booklet-")
    doc = setup_document()
    cover(doc)
    usage_page(doc)
    toc_page(doc)
    total_figs = 0
    for no, (title, fname, desc) in enumerate(CHAPTERS, 1):
        total_figs += chapter(doc, no, title, fname, desc, embed=(no == 3))
    docx_path = HERE / "提审材料册（合订本）.docx"
    doc.save(docx_path)
    print("[OK] DOCX %s（%.1f MB）" % (docx_path.name, docx_path.stat().st_size / 1e6))
    print("[OK] 内嵌图片 %d 张" % total_figs)
    pdf = convert_pdf(docx_path)
    if pdf:
        print("[OK] PDF  %s（%.1f MB）" % (pdf.name, pdf.stat().st_size / 1e6))


def convert_pdf(docx_path):
    node_candidates = [
        r"D:\AISI\Deepseek harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe",
        r"D:\AISI\dsh-data\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe",
    ]
    node = next((n for n in node_candidates if Path(n).is_file()), None)
    cli = Path(r"D:\AISI\Deepseek harness\resources\app.asar.unpacked\dsh\node_modules"
               r"\@deepseek-ai\libreoffice-kit\lib\cli.js")
    if node is None or not cli.is_file():
        print("[WARN] 找不到 LibreOffice Kit，跳过 PDF 转换", file=sys.stderr)
        return None
    out = HERE / "提审材料册（合订本）.pdf"
    if out.exists():
        out.unlink()
    proc = subprocess.run([node, str(cli), "convert", "--input", str(docx_path),
                           "--output", str(out)], capture_output=True, timeout=420)
    stdout = (proc.stdout or b"").decode("utf-8", "replace")
    stderr = (proc.stderr or b"").decode("utf-8", "replace")
    ok = out.is_file() and out.stat().st_size > 1024 and out.read_bytes()[:5] == b"%PDF-"
    if proc.returncode != 0 or not ok:
        print("[FAIL] PDF 转换失败 rc=%s\n%s\n%s" % (proc.returncode, stdout[-1500:],
                                                    stderr[-1500:]), file=sys.stderr)
        return None
    data = out.read_bytes()
    pages = len(re.findall(rb"/Type\s*/Page[^s]", data))
    print("[OK] PDF 页数（对象级估算）%d，%%PDF- 校验通过" % pages)
    return out


if __name__ == "__main__":
    main()
