// config/main-deps.js · 主包公共依赖声明（仅 require，不执行任何业务）
// 背景：以下模块只被分包（pkg-customer/pkg-partner/pkg-admin）引用，按仓库「单源」纪律放在主包共享；
// 微信开发者工具「代码质量 · 主包内不应存在主包未使用的 JS 文件」按主包可达性判定，会误报为未使用。
// 这里由主包入口显式 require 一次，声明它们是主包公共依赖；模块本身零副作用（只有定义），不改运行路径。
'use strict';

require('../api/modules/ai');
require('../api/privacy');
require('../shared/appoint');
require('../shared/audit-actions');
require('../utils/order-edit');
require('../utils/rebind');
require('../utils/recognize/index');
