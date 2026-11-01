#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""审核示意图生成脚本（docs/delivery/review/images/diagrams/）

用途：生成 4 张提交给微信审核的示意图（材料索引 / 审核体验路径 / 隐私数据流 / 零金额口径）。
只依赖 Pillow（捆绑 Python 已装 12.3）：白色背景、深灰文字 #1F2937、品牌绿 #1F7A5C、
浅灰辅助 #6B7280；输出宽度 2000px（2x 渲染，逻辑宽 1000px），PNG 每张 ≤600KB。

口径来源（全部为仓库文档真实内容，不编造数字/承诺）：
  01 材料索引   docs/delivery/V4_REVIEW_MATERIALS.md §1 / §5；AGENTS.md §7；app.json
  02 体验路径   docs/delivery/V4_REVIEW_MATERIALS.md §2.1 / §2.2 / §2.3；app.json；components/switch-bar
  03 隐私数据流 docs/privacy/隐私保护指引.md §一/§三/§五；config/defaults.js；REVIEW_MATERIALS §0
  04 零金额口径 docs/delivery/V4_REVIEW_MATERIALS.md §0 / §2.4；shared/enums.js；CONTRACT §5/§6

用法（在本目录执行；Windows 中文字体必需）：
  "D:\\AISI\\dsh-data\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe" build_diagrams.py
  或：python build_diagrams.py

注意：本文件只生成示意图，不含任何真实用户数据，不代表真机截图；真实页面截图由审核材料另附。
"""
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT_DIR = Path(__file__).resolve().parent
W = 2000
DPI = (192, 192)  # 2x（96 -> 192）

# ── 色板（任务指定 + 页面真实 token）────────────────────────────────────────
INK = (31, 41, 55)            # #1F2937 深灰正文
GRAY = (107, 114, 128)        # #6B7280 浅灰辅助
BRAND = (31, 122, 92)         # #1F7A5C 品牌绿
BRAND_SOFT = (234, 244, 239)  # 品牌绿浅底
BRAND_LINE = (178, 214, 199)
LINE = (209, 213, 219)        # #D1D5DB 边框
CARD = (249, 250, 251)        # #F9FAFB 卡片底
WHITE = (255, 255, 255)
WARN_BG = (255, 244, 206)     # 黄条（switch-bar-readonly）
WARN_INK = (138, 109, 0)
BLUE_BG = (232, 240, 255)     # 蓝条（switch-bar-blue）/ TEST 角标 #2B6DE5
BLUE_INK = (43, 109, 229)
RED = (185, 28, 28)
RED_SOFT = (254, 242, 242)
RED_LINE = (252, 165, 165)
AMBER = (180, 83, 9)
AMBER_SOFT = (255, 247, 237)

FONT_REG_CANDIDATES = [
    r"C:/Windows/Fonts/msyh.ttc",
    r"C:/Windows/Fonts/simhei.ttf",
]
FONT_BOLD_CANDIDATES = [
    r"C:/Windows/Fonts/msyhbd.ttc",
    r"C:/Windows/Fonts/msyh.ttc",
    r"C:/Windows/Fonts/simhei.ttf",
]

_FONT_CACHE = {}


def load_font(size, bold=False):
    key = (size, bold)
    if key in _FONT_CACHE:
        return _FONT_CACHE[key]
    candidates = FONT_BOLD_CANDIDATES if bold else FONT_REG_CANDIDATES
    for raw in candidates:
        path = Path(raw)
        if path.exists():
            _FONT_CACHE[key] = ImageFont.truetype(str(path), size=size, index=0)
            return _FONT_CACHE[key]
    raise SystemExit("找不到中文字体（C:/Windows/Fonts/msyh.ttc），无法生成示意图")


def tw(text, font):
    """文本宽度（像素）。"""
    return font.getlength(text)


def wrap_text(text, font, max_w):
    """按宽度折行：固定术语与 ASCII 连续串不拆（路径按 '/' 分段），中文逐字断行。"""
    tokens = re.findall(r"零金额|[A-Za-z0-9_@.:%+\-—·]+|/|\s+|.", text)
    lines = []
    cur = ""
    for token in tokens:
        candidate = cur + token
        if cur and tw(candidate, font) > max_w:
            lines.append(cur.rstrip())
            cur = token.lstrip() if token.strip() else ""
        else:
            cur = candidate
    if cur.strip():
        lines.append(cur.rstrip())
    # 避免「孤行标点」：行首标点并回上一行、纯标点行合并（行尾余量 ≥24px，不会出框）
    merged = []
    for line in lines:
        if merged and line and line[0] in "。，；、：！？）〕」』】%":
            merged[-1] = merged[-1] + line[0]
            line = line[1:]
            if not line:
                continue
        merged.append(line)
    return merged or [""]


def wrap_path(path_text, font, max_w):
    """路径折行：优先在 '/' 后断行，返回行列表（最多 2 行由调用方取用）。"""
    segments = re.findall(r"[^/]+/|[^/]+", path_text)
    lines = []
    cur = ""
    for seg in segments:
        candidate = cur + seg
        if cur and tw(candidate, font) > max_w:
            lines.append(cur)
            cur = seg
        else:
            cur = candidate
    if cur:
        lines.append(cur)
    return lines


def draw_lines(draw, x, y, lines, font, fill, line_h=None):
    lh = line_h if line_h else int(round(font.size * 1.55))
    for line in lines:
        draw.text((x, y), line, font=font, fill=fill)
        y += lh
    return y


def draw_para(draw, x, y, text, font, fill, max_w, line_h=None):
    lines = wrap_text(text, font, max_w)
    return draw_lines(draw, x, y, lines, font, fill, line_h)


def para_center(draw, box, text, font, fill, max_w, line_h=None):
    """在矩形内垂直居中画折行文本。"""
    x0, y0, x1, y1 = box
    lines = wrap_text(text, font, max_w)
    lh = line_h if line_h else int(round(font.size * 1.55))
    total = len(lines) * lh
    y = y0 + max(0, int(round((y1 - y0 - total) / 2))) + max(0, int(round((lh - font.size) / 2)))
    for line in lines:
        draw.text((x0, y), line, font=font, fill=fill)
        y += lh


def rounded(draw, box, fill=WHITE, outline=LINE, radius=16, width=2):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def arrow_right(draw, x0, x1, cy, color=LINE, width=4, head=11):
    draw.line([(x0, cy), (x1 - head, cy)], fill=color, width=width)
    draw.polygon([(x1, cy), (x1 - head - 1, cy - head), (x1 - head - 1, cy + head)], fill=color)


def header(draw, title, subtitle):
    draw.rectangle([0, 0, W, 12], fill=BRAND)
    draw.text((80, 62), title, font=load_font(58, True), fill=INK)
    draw.rounded_rectangle([80, 148, 208, 156], radius=4, fill=BRAND)
    draw_para(draw, 80, 176, subtitle, load_font(27), GRAY, W - 160)


def footer(draw, height, basis):
    """页脚：依据（左，超宽自动折行）+ 免责声明（右）。"""
    y = height - 96
    draw.line([(80, y), (W - 80, y)], fill=LINE, width=2)
    note = "示意图 · 不含真实用户数据 · 不代表真机截图"
    note_font = load_font(21)
    note_w = tw(note, note_font)
    draw.text((W - 80 - note_w, y + 20), note, font=note_font, fill=GRAY)
    draw_para(draw, 80, y + 20, basis, load_font(21), GRAY, W - 160 - note_w - 40)


def save(img, name, width_ok=(1600, 2000)):
    path = OUT_DIR / name
    img.save(path, format="PNG", optimize=True, dpi=DPI)
    size_kb = path.stat().st_size / 1024.0
    if not (width_ok[0] <= img.width <= width_ok[1]):
        raise SystemExit(f"{name}: 输出宽度 {img.width} 超出 {width_ok[0]}~{width_ok[1]}px")
    if size_kb > 600:
        raise SystemExit(f"{name}: 体积 {size_kb:.1f}KB 超过 600KB")
    return path, img.width, img.height, size_kb


# ═══════════════════════════════════════════════════════════════════════════
# 01 审核材料索引图
# ═══════════════════════════════════════════════════════════════════════════
def build_material_index():
    height = 1250
    img = Image.new("RGB", (W, height), WHITE)
    draw = ImageDraw.Draw(img)
    header(draw, "审核材料索引图",
           "提审前一次性核对：提审页必填 → 随附图片资料 → 说明文档（材料中只出现占位值，真实值由用户填写）")

    top, bottom = 232, 1000
    gap = 36
    card_w = (W - 160 - gap * 2) // 3  # 589
    xs = [80, 80 + card_w + gap, 80 + (card_w + gap) * 2]
    titles = ["① 提审页必填（微信公众平台）", "② 随附图片资料（images/）", "③ 说明文档（6 份）"]
    for idx, x0 in enumerate(xs):
        x1 = x0 + card_w
        rounded(draw, [x0, top, x1, bottom], fill=CARD, outline=LINE, radius=18)
        draw.rounded_rectangle([x0 + 24, top + 24, x0 + 32, top + 62], radius=4, fill=BRAND)
        draw.text((x0 + 46, top + 22), titles[idx], font=load_font(31, True), fill=INK)
        draw.line([(x0 + 24, top + 78), (x1 - 24, top + 78)], fill=LINE, width=2)

    content_top = top + 96
    content_bottom = bottom - 18
    content_h = content_bottom - content_top

    # 左列：提审页必填 5 项
    left_items = [
        ("版本号", "本次提审的版本号，与提审记录、体验版保持一致"),
        ("版本描述", "一句话说明 + 完整版 150~300 字 + 简版 ≤100 字"),
        ("功能页面", "≤10 个页面路径，直接取自 app.json 声明"),
        ("测试说明", "顾客 / 兼职 / 开发者后台三段体验路径；审核邀请码只给占位"),
        ("加急理由", "说明校园取件时效场景，并附随附图片与录屏"),
    ]
    row_h = content_h // 5
    for i, (name, desc) in enumerate(left_items):
        y = content_top + i * row_h
        draw.ellipse([xs[0] + 24, y + 10, xs[0] + 60, y + 46], fill=BRAND_SOFT, outline=BRAND_LINE, width=2)
        draw.text((xs[0] + 33, y + 14), str(i + 1), font=load_font(23, True), fill=BRAND)
        draw.text((xs[0] + 76, y + 8), name, font=load_font(27, True), fill=INK)
        draw_para(draw, xs[0] + 76, y + 48, desc, load_font(21), GRAY, card_w - 100)
        if i:
            draw.line([(xs[0] + 24, y - 8), (xs[0] + card_w - 24, y - 8)], fill=(229, 231, 235), width=1)

    # 中列：随附图片资料
    mid_items = [
        ("images/screenshots/ · 真实页面截图",
         "顾客端 / 兼职端 / 开发者后台只读与测试 / 隐私与协议页面；文件名、页面路径与图注见 02_审核截图清单与图注.md"),
        ("images/screenshots/ · 微信后台声明截图",
         "《用户隐私保护指引》逐项声明与勾选截图（提审前置 P0-5）"),
        ("images/diagrams/ · 示意图 4 张",
         "01 材料索引 / 02 体验路径 / 03 隐私数据流 / 04 零金额口径图（即本目录）"),
    ]
    block_h = content_h // 3 - 8
    for i, (name, desc) in enumerate(mid_items):
        y = content_top + i * (block_h + 12)
        rounded(draw, [xs[1] + 24, y, xs[1] + card_w - 24, y + block_h], fill=WHITE, outline=LINE, radius=12)
        draw.text((xs[1] + 44, y + 18), name, font=load_font(25, True), fill=BRAND)
        draw_para(draw, xs[1] + 44, y + 62, desc, load_font(21), GRAY, card_w - 88)

    # 右列：说明文档 6 份
    docs = [
        ("00_材料包总览与使用顺序.md", "先读哪份、按什么顺序提交"),
        ("01_提审文案（可直接粘贴）.md", "字段速查 + 完整版/简版审核说明"),
        ("02_审核截图清单与图注.md", "每张截图文件名/路径/图注/审核要点"),
        ("03_隐私声明对照表.md", "后台声明项 / 代码调用点 / 端内文本"),
        ("04_类目备案与业务说明.md", "类目/备案/功能清单/追问答复"),
        ("05_提审操作步骤与证据归档.md", "操作步骤 + 证据表 + 驳回处理"),
    ]
    row_h2 = content_h // 6
    for i, (name, desc) in enumerate(docs):
        y = content_top + i * row_h2
        draw.rounded_rectangle([xs[2] + 24, y + 14, xs[2] + 36, y + 50], radius=4, fill=BRAND_LINE)
        draw.text((xs[2] + 48, y + 6), name, font=load_font(23, True), fill=INK)
        draw.text((xs[2] + 48, y + 44), desc, font=load_font(20), fill=GRAY)

    # 底部红线
    banner = [80, 1018, W - 80, 1086]
    draw.rounded_rectangle(banner, radius=14, fill=INK)
    text = "不代提审、不代填真实值；真实 openid / appid / 邀请码 / 联系方式不落仓库"
    font = load_font(29, True)
    draw.text(((W - tw(text, font)) / 2, 1039), text, font=font, fill=WHITE)

    footer(draw, height,
           "依据：docs/delivery/V4_REVIEW_MATERIALS.md §1 / §5；AGENTS.md §7；功能页面取自 app.json")
    return img, "01_审核材料索引图.png"


# ═══════════════════════════════════════════════════════════════════════════
# 02 审核体验路径图
# ═══════════════════════════════════════════════════════════════════════════
LANE_LABEL_W = 180


def _lane(draw, y0, y1, label, sub, tint, ink):
    x0 = 80
    draw.rounded_rectangle([x0, y0, x0 + LANE_LABEL_W, y1], radius=16, fill=tint)
    draw.text((x0 + 30, y0 + 40), label, font=load_font(38, True), fill=ink)
    draw_lines(draw, x0 + 30, y0 + 94, wrap_text(sub, load_font(17), LANE_LABEL_W - 48), load_font(17), GRAY, line_h=22)


def _chips(draw, y0, chips, accent, col_w, gap):
    area_x0, area_x1 = 80 + LANE_LABEL_W + 24, W - 80
    label_font = load_font(24, True)
    note_font = load_font(16)
    chip_h = 142
    chip_y = y0 + 30
    for i, (label, path_text, note) in enumerate(chips):
        x = area_x0 + i * (col_w + gap)
        rounded(draw, [x, chip_y, x + col_w, chip_y + chip_h], fill=WHITE, outline=LINE, radius=14)
        draw.rounded_rectangle([x, chip_y, x + 6, chip_y + chip_h], radius=3, fill=accent)
        draw.text((x + 18, chip_y + 14), label, font=label_font, fill=INK)
        for size in (12, 11):
            lines = wrap_path(path_text, load_font(size), col_w - 32)
            if len(lines) <= 2:
                break
        draw_lines(draw, x + 18, chip_y + 56, lines[:2], load_font(size), GRAY, line_h=18)
        if note:
            draw.text((x + 18, chip_y + chip_h - 36), note, font=note_font, fill=accent)
        if i < len(chips) - 1:
            arrow_right(draw, x + col_w + 8, x + col_w + gap - 8, chip_y + chip_h // 2, color=LINE, width=4, head=10)


def build_experience_path():
    height = 1280
    img = Image.new("RGB", (W, height), WHITE)
    draw = ImageDraw.Draw(img)
    header(draw, "审核体验路径图",
           "三条泳道：顾客 / 兼职 / 开发者后台（页面路径取自 app.json）；一个微信号即可跑通兼职端完整履约")

    lane_h, lane_gap = 210, 18
    lanes_y = [235, 235 + lane_h + lane_gap, 235 + (lane_h + lane_gap) * 2]
    _lane(draw, lanes_y[0], lanes_y[0] + lane_h, "顾客", "自助走通", BRAND_SOFT, BRAND)
    _lane(draw, lanes_y[1], lanes_y[1] + lane_h, "兼职", "邀请码激活", BLUE_BG, BLUE_INK)
    _lane(draw, lanes_y[2], lanes_y[2] + lane_h, "开发者", "白名单进入", (243, 244, 246), GRAY)

    customer = [
        ("隐私弹窗", "pages/launch/index", "先读后同意"),
        ("身份选择", "pages/role/index", "我是顾客"),
        ("顾客首页", "pages/customer/home/index", ""),
        ("资料/编号", "pages/profile/index", "昵称必填·头像可选"),
        ("下单四步", "pkg-customer/pages/order-create/index", "0~10 张或手填"),
        ("订单详情", "pkg-customer/pages/order-detail/index", "进度时间线"),
        ("我的取件码", "pkg-customer/pages/pickup-list/index", "本机·可清空"),
    ]
    partner = [
        ("身份选择", "pages/role/index", "我是兼职"),
        ("激活", "pkg-partner/pages/activate/index", "邀请码 12 位"),
        ("服务配置", "pkg-partner/pages/service-settings/index", "服务类型/苑"),
        ("代客下单", "pkg-partner/pages/create-on-behalf/index", "新顾客·免绑定"),
        ("接单", "pages/partner/workbench/index", "工作台待接单"),
        ("已取件", "pages/partner/workbench/index", "批量勾选"),
        ("送达", "pages/partner/workbench/index", "批量送达"),
        ("单量统计", "pkg-partner/pages/stats/index", "完成率/异常"),
    ]
    admin = [
        ("后台总览", "pkg-admin/pages/overview/index", "白名单自动分流"),
        ("切换账号", "pkg-admin/pages/account-switch/index", "真实只读/测试"),
        ("识别失败复核", "pkg-admin/pages/recognition-review/index", "逐次审计"),
        ("审计查询", "pkg-admin/pages/overview/index", "审计区块"),
    ]
    area_x0, area_x1 = 80 + LANE_LABEL_W + 24, W - 80
    usable = area_x1 - area_x0
    gap1 = 38
    chip_w1 = (usable - gap1 * 6) // 7
    gap2 = 32
    chip_w2 = (usable - gap2 * 7) // 8
    admin_w, admin_gap = 270, 34
    _chips(draw, lanes_y[0], customer, BRAND, chip_w1, gap1)
    _chips(draw, lanes_y[1], partner, BLUE_INK, chip_w2, gap2)
    _chips(draw, lanes_y[2], admin, GRAY, admin_w, admin_gap)

    # 开发者泳道：右侧黄条/蓝条图例
    lx0 = area_x0 + 4 * admin_w + 3 * admin_gap + 46
    lx1, ly0 = W - 80, lanes_y[2] + 24
    ly1 = lanes_y[2] + lane_h - 24
    rounded(draw, [lx0, ly0, lx1, ly1], fill=CARD, outline=LINE, radius=14)
    draw.text((lx0 + 20, ly0 + 12), "会话标识（页面顶部条）", font=load_font(22, True), fill=INK)
    draw.rounded_rectangle([lx0 + 20, ly0 + 50, lx1 - 20, ly0 + 90], radius=8, fill=WARN_BG)
    draw.text((lx0 + 34, ly0 + 59), "开发者只读视角 · 黄条", font=load_font(19, True), fill=WARN_INK)
    draw.rounded_rectangle([lx0 + 20, ly0 + 96, lx1 - 20, ly0 + 136], radius=8, fill=BLUE_BG)
    draw.rounded_rectangle([lx0 + 26, ly0 + 103, lx0 + 86, ly0 + 129], radius=4, fill=BLUE_INK)
    draw.text((lx0 + 34, ly0 + 108), "TEST", font=load_font(16, True), fill=WHITE)
    draw.text((lx0 + 98, ly0 + 105), "测试账号 · 蓝条 + TEST 角标", font=load_font(18, True), fill=BLUE_INK)
    draw_para(draw, lx0 + 20, ly0 + 144, "真实只读 / 测试可写；退出后统计不变。",
              load_font(17), GRAY, lx1 - lx0 - 40)

    # 底部三条要点
    notes = [
        ("顾客侧", "截图自愿（每单 0~10 张）；无截图可手填「无截图·手填」；头像可拒绝，显示默认头像。"),
        ("兼职侧", "一个微信号单机跑通：代客下单（新顾客）→ 接单 → 已取件 → 送达；绑定只能由顾客发起。"),
        ("开发者后台", "仅 ADMIN_OPENIDS 白名单可进入（无自助入口）；真实账号只读、测试账号为合成；审核员用录屏与截图。"),
    ]
    note_w = (W - 160 - 30 * 2) // 3
    for i, (title, body) in enumerate(notes):
        x0 = 80 + i * (note_w + 30)
        rounded(draw, [x0, 926, x0 + note_w, 1100], fill=CARD, outline=LINE, radius=16)
        draw.text((x0 + 24, 944), title, font=load_font(25, True), fill=BRAND)
        draw_para(draw, x0 + 24, 988, body, load_font(20), INK, note_w - 48)

    footer(draw, height,
           "依据：docs/delivery/V4_REVIEW_MATERIALS.md §2.1~§2.3；app.json；components/switch-bar")
    return img, "02_审核体验路径图.png"


# ═══════════════════════════════════════════════════════════════════════════
# 03 隐私数据流图
# ═══════════════════════════════════════════════════════════════════════════
def build_privacy_flow():
    height = 1390
    img = Image.new("RGB", (W, height), WHITE)
    draw = ImageDraw.Draw(img)
    header(draw, "隐私数据流图",
           "采集 → 处理与存放（本机 / 云端）→ 留存与删除；取件码截图每单 0~10 张，且无截图可手填")

    cols = [(80, 640), (720, 1280), (1360, 1920)]
    heads = ["采集（用户主动）", "处理与存放（本机 / 云端）", "留存与删除"]
    for i, (x0, x1) in enumerate(cols):
        fill = [INK, BRAND, GRAY][i]
        rounded(draw, [x0, 216, x1, 262], fill=fill, outline=None, radius=10)
        font = load_font(24, True)
        draw.text((x0 + (x1 - x0 - tw(heads[i], font)) / 2, 224), heads[i], font=font, fill=WHITE)

    rows = [
        ("① 取件码截图（每单 0~10 张，自愿）",
         "相册 / 拍照 / 聊天三来源；单图 ≤500KB（jpg/png）；可无截图手填（D24/D40）。",
         "端侧识别 + 云端复核",
         "识别在本机完成；失败时仅把去敏文字发 DeepSeek（不含原图 / 微信标识 / 联系方式 / 头像昵称）；原图进复核队列。",
         "有截图订单完成后 7 天删除（引用计数）；失败原图默认 30 天（7~30 可配），每次查看落审计。"),
        ("② 昵称与头像（头像可拒绝）",
         "昵称必填（≤20 字，可一键取微信昵称）；头像自愿，拒绝后显示默认头像。",
         "私有云存储",
         "头像经约 5 分钟临时链接展示；仅当前绑定对方可见；后台不展示头像、昵称脱敏。",
         "随账号存续；替换头像即删旧文件；解绑 / 停用 / 注销后立即停止下发。"),
        ("③ 我的取件码（本机清单 · D57）",
         "顾客自己添加：手动输入 / 粘贴多个码，或端侧识别截图添加。",
         "仅本机存储",
         "仅存本机键 ex_college_v4.pickcodes：不上传、不共享；兼职端与后台（含只读）不可见。",
         "上限 50 条按码去重、可一键清空；换机 / 清缓存即丢失；不进日志 / 通知 / 分享卡片。"),
        ("④ 剪切板（仅主动复制 / 粘贴）",
         "仅在你主动点「复制」时写入订单号或编号；主动点「粘贴」时读取编号填入。",
         "不落盘",
         "不保存、不上传；内容不进服务器与日志。",
         "无留存（仅本机系统剪贴板行为）。"),
    ]
    row_h, row_gap = 196, 16
    top = 276
    body_font = load_font(20)
    for r, row in enumerate(rows):
        y0 = top + r * (row_h + row_gap)
        label, c1, mid_title, c2, c3 = row
        for i, (x0, x1) in enumerate(cols):
            rounded(draw, [x0, y0, x1, y0 + row_h], fill=CARD if i == 1 else WHITE, outline=LINE, radius=14)
        draw.text((cols[0][0] + 26, y0 + 18), label, font=load_font(23, True), fill=INK)
        draw_para(draw, cols[0][0] + 26, y0 + 58, c1, body_font, GRAY, cols[0][1] - cols[0][0] - 52)
        draw.text((cols[1][0] + 26, y0 + 18), mid_title, font=load_font(23, True), fill=BRAND)
        draw_para(draw, cols[1][0] + 26, y0 + 58, c2, body_font, GRAY, cols[1][1] - cols[1][0] - 52)
        draw.text((cols[2][0] + 26, y0 + 18), "到期处理", font=load_font(23, True), fill=GRAY)
        draw_para(draw, cols[2][0] + 26, y0 + 58, c3, body_font, GRAY, cols[2][1] - cols[2][0] - 52)
        cy = y0 + row_h // 2
        arrow_right(draw, cols[0][1] + 8, cols[1][0] - 8, cy, color=BRAND_LINE, width=4, head=11)
        arrow_right(draw, cols[1][1] + 8, cols[2][0] - 8, cy, color=BRAND_LINE, width=4, head=11)

    # 删除与注销链路
    box = [80, 1130, W - 80, 1230]
    draw.rounded_rectangle(box, radius=14, fill=INK)
    draw.text((104, 1146), "删除与注销链路", font=load_font(25, True), fill=WHITE)
    draw_para(draw, 104, 1180,
              "订单完成或取消后 180 天匿名化 → 再 30 天物理删除；主动「删除记录」的已完成订单 7 天后物理删除；"
              "注销账号（我的 → 账号 → 注销账号）→ 30 天内物理删除，头像与截图即时删除。",
              load_font(20), (229, 231, 235), W - 208)

    footer(draw, height,
           "依据：docs/privacy/隐私保护指引.md §一/§三/§五；config/defaults.js；V4_REVIEW_MATERIALS.md §0")
    return img, "03_隐私数据流图.png"


# ═══════════════════════════════════════════════════════════════════════════
# 04 零金额口径图
# ═══════════════════════════════════════════════════════════════════════════
def build_zero_business():
    height = 1250
    img = Image.new("RGB", (W, height), WHITE)
    draw = ImageDraw.Draw(img)
    header(draw, "零金额口径图",
           "本小程序只提供下单、接单与取件信息整理，不涉及任何金钱交易；全链路没有支付或账目功能")

    # 左：本程序的状态机（信息与履约工具）
    left = [80, 225, 1040, 905]
    rounded(draw, left, fill=CARD, outline=LINE, radius=18)
    draw.text((left[0] + 28, left[1] + 22), "本小程序：信息与履约工具", font=load_font(34, True), fill=BRAND)
    draw.text((left[0] + 28, left[1] + 72), "7 个状态只表达履约进度；节点上没有支付、没有账目、没有数值计算。",
              font=load_font(21), fill=GRAY)

    states = ["待接单", "已接单", "已取件·配送中", "已送达·待确认", "已完成"]
    sx0, sx1 = left[0] + 32, left[2] - 32
    chip_w = (sx1 - sx0 - 4 * 22) // 5
    chip_y, chip_h = left[1] + 132, 84
    state_font = load_font(21, True)
    for i, state in enumerate(states):
        x = sx0 + i * (chip_w + 22)
        draw.rounded_rectangle([x, chip_y, x + chip_w, chip_y + chip_h], radius=12, fill=BRAND_SOFT,
                               outline=BRAND_LINE, width=2)
        para_center(draw, (x + 8, chip_y, x + chip_w - 8, chip_y + chip_h), state, state_font, BRAND, chip_w - 20)
        if i < len(states) - 1:
            arrow_right(draw, x + chip_w + 4, x + chip_w + 18, chip_y + chip_h // 2, color=BRAND_LINE, width=4, head=8)

    branch_font = load_font(20, True)
    branch_y = chip_y + chip_h + 26
    for i, (text, tint, ink) in enumerate([("已取消", (243, 244, 246), GRAY), ("异常·待处理", AMBER_SOFT, AMBER)]):
        bx = sx0 + i * 250
        draw.rounded_rectangle([bx, branch_y, bx + 220, branch_y + 62], radius=10, fill=tint, outline=LINE, width=2)
        para_center(draw, (bx + 10, branch_y, bx + 210, branch_y + 62), text, branch_font, ink, 200)
    draw.text((sx0 + 520, branch_y + 16), "终态 / 异常分支同样没有账目字段", font=load_font(20), fill=GRAY)

    # 服务类型（只表达做什么）
    svc_y = branch_y + 100
    draw.text((left[0] + 28, svc_y), "服务类型只表达「做什么」（D41 两档）", font=load_font(24, True), fill=INK)
    services = [
        ("标准代取", "驿站取件送到寝室门口（上楼）"),
        ("送至楼下", "送到宿舍楼下 / 约定地点（不上楼）"),
    ]
    svc_w = (sx1 - sx0 - 24) // 2
    for i, (name, desc_text) in enumerate(services):
        x = sx0 + i * (svc_w + 24)
        y = svc_y + 42
        draw.rounded_rectangle([x, y, x + svc_w, y + 92], radius=12, fill=WHITE, outline=LINE, width=2)
        draw.text((x + 18, y + 14), name, font=load_font(23, True), fill=BRAND)
        draw_para(draw, x + 18, y + 50, desc_text, load_font(19), GRAY, svc_w - 36)

    # 7 状态枚举（单源：shared/enums.js）
    en_y = svc_y + 156
    draw.text((left[0] + 28, en_y), "7 状态枚举（shared/enums.js 单源；页面不出现支付/账目状态）",
              font=load_font(21, True), fill=GRAY)
    enums = "SUBMITTED · ACCEPTED · PICKED · DELIVERED · COMPLETED · CANCELLED · EXCEPTION"
    draw_para(draw, left[0] + 28, en_y + 34, enums, load_font(18), GRAY, left[2] - left[0] - 56)

    # 右：支付类产品对比（打叉）
    right = [1080, 225, 1920, 905]
    rounded(draw, right, fill=(253, 253, 253), outline=LINE, radius=18)
    draw.text((right[0] + 28, right[1] + 22), "支付类产品（本程序没有）", font=load_font(32, True), fill=GRAY)
    draw.text((right[0] + 28, right[1] + 70), "对比示意：以下能力一律不存在，页面与接口里也没有对应字段。",
              font=load_font(20), fill=GRAY)
    crossed = ["支付", "退款", "账目", "对账"]
    cw, ch = 340, 150
    margin = (right[2] - right[0] - (cw * 2 + 60)) // 2
    for i, name in enumerate(crossed):
        x = right[0] + margin + (i % 2) * (cw + 60)
        y = right[1] + 130 + (i // 2) * (ch + 40)
        draw.rounded_rectangle([x, y, x + cw, y + ch], radius=16, fill=RED_SOFT, outline=RED_LINE, width=2)
        draw.line([(x + 46, y + 34), (x + cw - 46, y + ch - 34)], fill=RED_LINE, width=8)
        draw.line([(x + cw - 46, y + 34), (x + 46, y + ch - 34)], fill=RED_LINE, width=8)
        font = load_font(42, True)
        para_center(draw, (x + 20, y + 18, x + cw - 20, y + ch - 46), name, font, INK, cw - 40)
        tag_font = load_font(18)
        tag = "本程序没有"
        draw.text((x + (cw - tw(tag, tag_font)) / 2, y + ch - 40), tag, font=tag_font, fill=RED)

    draw_para(draw, right[0] + 28, right[3] - 92,
              "没有支付组件与回调；没有账目字段；没有金钱计算或对账环节。",
              load_font(21), INK, right[2] - right[0] - 56)

    # 底部三条口径
    cards = [
        ("① 服务类型只表达「做什么」", "名称 + 说明，没有数量、记录或账目概念。"),
        ("② 状态机只表达履约进度", "提交 → 接单 → 取件 → 送达 → 完成 / 异常 / 取消；没有支付、退款一类状态。"),
        ("③ 统计只有四类", "单量、完成率、状态分布、异常数；没有收入、账期或报表指标。"),
    ]
    card_w = (W - 160 - 60) // 3
    for i, (title, body) in enumerate(cards):
        x = 80 + i * (card_w + 30)
        rounded(draw, [x, 930, x + card_w, 1120], fill=CARD, outline=LINE, radius=16)
        draw.text((x + 24, 950), title, font=load_font(25, True), fill=BRAND)
        draw_para(draw, x + 24, 996, body, load_font(21), INK, card_w - 48)

    footer(draw, height,
           "依据：docs/delivery/V4_REVIEW_MATERIALS.md §0/§2.4；shared/enums.js；CONTRACT §5/§6")
    return img, "04_零金额口径图.png"


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    outputs = []
    for builder in (build_material_index, build_experience_path, build_privacy_flow, build_zero_business):
        img, name = builder()
        outputs.append(save(img, name))
    print("diagrams: OK (2000px wide, 2x, white bg, brand green #1F7A5C)")
    for path, width, height_px, size_kb in outputs:
        print(f"  {path.name}  {width}x{height_px}px  {size_kb:.1f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
