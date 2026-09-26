// pages/pickup-list/index.js · 取件清单（底栏左格 = 启动页，SCOPE M1/M10）
// 为什么本页几乎不算东西：分组、组内排序、派生字段全在 `utils/aggregate.buildPickupList`
//（ARCHITECTURE §2.2「纯逻辑与副作用分文件」+ SCOPE W2「不许顺手改排序」⇒ 页面只取数与渲染）。
// 刻意**不含**（各自另开卡，别当遗漏）：左滑删除（W1）、三级排序（W2）、整站批量取完（不在本期 Must）。
// 另：`buildPickupList` 还会返回 `doneItems` / `archivedItems`，本期**不上屏**（SCOPE S2 只要求已取件区）。
// 本期没有任何界面会把 `status` 写成 `done` 或写 `archivedAt` ⇒ 这两区现在是空的；
// 将来做"已送达"入口时必须一并补上它们的展示，否则记录会"点了就看不见"。
'use strict';

const storage = require('../../utils/storage.js');
const aggregate = require('../../utils/aggregate.js');
const { reasonText } = require('../../utils/reason.js');
const listParts = require('./list-parts.js');   // 本页纯决策（入口判据；页面层零断言 TD-016）

// 取件时间 → 人话。为什么住在页面层：storage/aggregate 只存与算**时间戳**，
// 时间怎么给人看是展示口径（会变、与库无关），下沉进纯函数反而会把口径钉死。
function formatPickedAt(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const pad = (value) => (value < 10 ? '0' + value : '' + value);
  return (date.getMonth() + 1) + '月' + date.getDate() + '日 ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

Page({
  data: {
    todoGroups: [],
    // 「未归类」分组（2026-09-25 用户裁决 A）：取消建档留下的件在清单里**必须看得见**
    // （⛔ 只存不给出口 = 造一个看不见的黑洞）；重归候选也一并上屏，按钮文案由零件给。
    unassignedItems: [],
    unassignedCount: 0,
    unassignedHead: '',
    unassignedHint: '',
    reassignOptions: [],
    reassignLabels: [],
    reassignText: '',
    pickedItems: [],
    pickedCount: 0,
    // 已取件区默认展开（v1 的实测结论沿用）：跑站点时"哪些已经拿到手"是最需要一眼看到的信息
    showPicked: true,
    isEmpty: true,
    todoEmpty: true,
    hasHistory: false,
    // null = 读库失败或还没读过 ⇒ "不知道有没有客户"，此时不许对人说"先建档"（那是另一种错）
    hasCustomers: null,
    errorText: '',
    // 收起的站点集合。**记"收起"而不是"展开"**：默认全展开（新出现的站点自动是展开态），
    // 不必在每次 refresh 时补登记，也就不会出现"新站点默认是收起的"这类怪状态
    collapsedStations: {}
  },

  // 每次显示都读库（清单的真相在库里：在档案页/录入页改完，回到本页必须看到）
  onShow() {
    this.refresh();
  },

  refresh() {
    const customers = storage.listCustomers();
    const parcels = storage.listParcels(); // 默认已排除软删除
    if (!customers.ok || !parcels.ok) {
      const reason = customers.ok ? parcels.reason : customers.reason;
      this.setData({
        todoGroups: [], unassignedItems: [], unassignedCount: 0, unassignedHead: '',
        pickedItems: [], pickedCount: 0,
        isEmpty: true, todoEmpty: true, hasHistory: false,
        hasCustomers: null,
        errorText: reasonText(reason)
      });
      return;
    }
    // 先把「未归类」那一组分流出来：它们不进按站点的分组（否则"哪些件还没归属"再也看不出来），
    // 但**必须上屏**并给重归出口 —— 判据在零件 `list-parts.js` 里（页面层零断言 TD-016），这里只取数。
    const split = listParts.splitUnassigned(parcels.parcels);
    const list = aggregate.buildPickupList(split.rest, customers.customers);
    const reassign = listParts.reassignOptions(customers.customers);
    const collapsed = this.data.collapsedStations;
    // M13 的"带着客户进录入页"只有一种情况允许：**库里恰好一个客户**。
    // 两个以上就不带（M7 的同一条纪律：宁可不猜），让录入页要求手选 —— 猜错客户的代价是
    // 快递记到别人名下，比多点一次选择器贵得多。
    const alive = aggregate.sortCustomers(customers.customers);
    // 展开态在这里**预计算成普通布尔字段**：WXML 取不到 `collapsedStations[动态键]` 这种写法（v1 实测）
    const todoGroups = list.todoGroups.map((group) => ({
      key: group.key,
      stationName: group.stationName,
      items: group.items,
      count: group.items.length,
      expanded: !collapsed[group.key]
    }));
    // 空态判据下沉在 aggregate.todoEmptyState（同一规则有两处历史事故：漏"已取件"、漏"已归档"）
    const empty = aggregate.todoEmptyState(list);
    this.setData({
      todoGroups: todoGroups,
      unassignedItems: split.unassigned.map((parcel) => ({
        id: parcel.id, stationName: parcel.stationName, pickupCode: parcel.pickupCode,
        lockerNo: parcel.lockerNo || '', trackingTail: parcel.trackingTail || ''
      })),
      unassignedCount: split.unassigned.length,
      unassignedHead: listParts.unassignedHeadText(split.unassigned.length),
      unassignedHint: listParts.unassignedHint(),
      reassignOptions: reassign,
      reassignLabels: reassign.map((option) => option.label),
      reassignText: listParts.reassignText(reassign),
      pickedItems: list.pickedItems.map((item) => Object.assign({}, item, { pickedText: formatPickedAt(item.pickedAt) })),
      pickedCount: list.pickedItems.length,
      // ⚠️ 「未归类」那一组也算"有东西"：不然"还没有快递"会和那张卡同屏出现（自相矛盾）
      isEmpty: empty.isEmpty && split.unassigned.length === 0,
      todoEmpty: empty.todoEmpty && split.unassigned.length === 0,
      hasHistory: empty.hasHistory,
      hasCustomers: alive.length > 0,
      errorText: ''
    });
  },

  // M13：清单页的快速入库入口（用户界面构想第 1 条"栏中间应该有快速入库的入口"）。
  // 2026-09-25 真机反馈批改了两点（用户原话）：
  //   ①「没有用户档案时仍然无法进行录入操作」⇒ 一个档案都没有时**照样进录入页**（那里能当场建）；
  //   ②「取件清单的录快件不应该默认绑定，而只有从用户档案进入的录快件才进行默认绑定」
  //      ⇒ 不再携带 `customerId`：归属由人在录入页里选或建。**判据在 `./list-parts.js`**（页面层零断言 TD-016）。
  onQuickIntake() {
    const target = listParts.intakeTarget({ hasCustomers: this.data.hasCustomers });
    if (!target.ok) {
      // 读库失败时不能催人造档：那会把"库读不出来"说成"你还没建档"
      this.setData({ errorText: target.errorText });
      return;
    }
    wx.navigateTo({
      url: target.url,
      fail: (err) => {
        this.setData({ errorText: '进不去录入页：' + ((err && err.errMsg) || '未知原因') });
      }
    });
  },

  // 「未归类」分组：把这一组**整批**归给选中的客户。写口只有 `storage.reassignUnassigned` 一个
  // （它内部只认占位档案名下的件，方向反了会被它拒；`saveStore` 还会跑全库校验 ⇒ 不会留悬空引用）。
  // 为什么用 `<picker>` 而不是 `showActionSheet`：后者的 itemList 有条数上限，客户一多就静默缺项。
  onReassignPick(event) {
    const target = this.data.reassignOptions[Number(event.detail.value)];
    if (!target) return;
    const moved = storage.reassignUnassigned(target.id);
    if (!moved.ok) {
      wx.showToast({ title: reasonText(moved.reason), icon: 'none' });
      return;
    }
    wx.showToast({
      title: moved.moved > 0 ? ('已归给 ' + target.label + '：' + moved.moved + ' 件') : '这一组没有可归的件',
      icon: 'none'
    });
    this.refresh();
  },

  // 站点头 = 收起/展开整站（只影响渲染，不动数据）
  onToggleStation(event) {
    const key = event.currentTarget.dataset.key;
    const collapsed = Object.assign({}, this.data.collapsedStations);
    if (collapsed[key]) delete collapsed[key];
    else collapsed[key] = true;
    this.setData({ collapsedStations: collapsed });
    this.refresh();
  },

  onTogglePickedSection() {
    this.setData({ showPicked: !this.data.showPicked });
  },

  // 勾选方块（M10）：勾上 = "已取到这件"（写 `pickedAt`），**不是"已送达"**——
  // 拿到手与交到客户手上是两段（v1 的两段式裁决），本期只兑现前一段；状态枚举保持 todo/done 两态。
  // 为什么自己画方块而不是官方 `<checkbox>`：官方件要页面自己维护 checked，会与"以库为准"的 refresh 打架；
  // 方块能给到 88rpx 的整块触摸盒（无障碍口径见 wxss 的 `.check-box`）。
  onTogglePickedItem(event) {
    const id = event.currentTarget.dataset.id;
    const row = this.findRow(id);
    if (!row) {
      // 这条刚被别处删掉/归档 ⇒ 不是错误，但屏上列表已经过期：重取一次，让人看到真实状态
      this.refresh();
      return;
    }
    const changed = storage.setParcelPicked(id, !row.picked);
    if (!changed.ok) {
      wx.showToast({ title: reasonText(changed.reason), icon: 'none' });
      return;
    }
    this.refresh();
  },

  // 在两个分区里找这一条，并带出它当前是不是已取件（取消勾选要能把 pickedAt 清掉）
  findRow(id) {
    // 未归类那一组也要能勾（勾选 = 已取到这件）：漏了它，那些行的方块点了没反应
    for (const item of this.data.unassignedItems) {
      if (item.id === id) return { picked: false };
    }
    for (const group of this.data.todoGroups) {
      for (const item of group.items) {
        if (item.id === id) return { picked: false };
      }
    }
    for (const item of this.data.pickedItems) {
      if (item.id === id) return { picked: true };
    }
    return null;
  }
});
