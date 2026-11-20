# `ego-browser` 双视口实机核验操作指南

涉及前端界面、交互或线上发布巡检时，统一使用全局 `ego-browser` 技能按以下标准流程执行，避免触发防逆向熔断或视口复位。

## 1. 本地隔离验证服务启动

使用独立临时 `DATA_DIR` 启动生产构建服务，读取自动生成的超管初始凭证：

```bash
rm -rf /tmp/yj-qa && mkdir -p /tmp/yj-qa
PORT=18908 DATA_DIR=/tmp/yj-qa node server/index.mjs
# 初始凭证文件 /tmp/yj-qa/admin-credentials.txt 格式：
# ADMIN_USER=yjadmin
# ADMIN_INITIAL_PASSWORD=<随机密码>
```

## 2. 防逆向护盾与工作台标准选择器

- **保持常规页面通道**：仅使用 `ego-browser` 标准页面 API（`snapshot`、`click`、`fill`、`evaluate`、`screenshot`）与 `Emulation.setDeviceMetricsOverride`；避免开启 CDP `Debugger` 域或发送 `F12` 快捷键（会触发 `src/security/antiReverseShield.ts` 写入 48h `security-bans.json` 熔断）。
- **工作台高频元素无歧义选择器**（适配 `Spec 0010/0011` `1-2-3` 三步向导，避免同名候选超时重试）：
  - 登录表单：`loc=css:input[placeholder="请输入分配的成员账号"]`、`loc=css:input[placeholder="请输入通行密码"]`、提交按钮 `text=验证身份并进入精算工作台`。
  - 配单页签：桌面顶栏步骤按钮文案为 `② 3+1 精算配单`（匹配 `text=② 3+1 精算配单`，避开空态区的 `"去 3+1 精算配单"`）；移动端底栏四页签为 `text=赛事雷达`、`text=精算配单`、`text=精算审单`、`text=风控账本`；四档槽位使用子串匹配 `text=稳健保本`、`text=期望效用`、`text=容错缩水`、`text=错价雷达`。
  - 说明书预设收起：点击 `text=说明书` 内的演示按钮（如 `text=早晚锁利`）加载预设后，先关闭说明书弹窗（点击弹窗 `关闭` / `✕` 按钮）再校验主工作台元素。
- **弹簧滚轮稳定等待**：底部金额栏（`slipAmtRef`）带有 240Hz 弹簧滚轮过渡动画，点击「套用方案」或切换预设后等待 `>= 650ms` 再调用 `page.screenshot()`，确保拍到稳定终值。

## 3. 单脚本双视口（桌面 `>= 960px` + 移动 `< 960px`）核验模板

`Emulation.setDeviceMetricsOverride` 生命周期绑定单次 `ego-browser nodejs` 进程的 CDP 会话，因此视口设置、`resize` 事件触发与截图须放在**同一次脚本调用**内完成，且统一传 `mobile: false` 以避免移动端触控缩放偏移：

```bash
ego-browser nodejs <<'EOF'
const task = await taskSpace("Dual-viewport QA");
const page = task.page("p1");

// Desktop (>= 960px)
await page.cdp("Emulation.setDeviceMetricsOverride", {
  width: 1520,
  height: 920,
  deviceScaleFactor: 2,
  mobile: false,
});
await page.goto("http://127.0.0.1:18908/");
// ... 登录 -> text=② 3+1 精算配单 -> 槽位核验 ...
await page.waitForTimeout(650);
await page.screenshot({ path: "/tmp/desktop-qa.png" });

// Mobile (< 960px, 含超管按钮窄屏预算校核)
await page.cdp("Emulation.setDeviceMetricsOverride", {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  mobile: false,
});
await page.evaluate(() => {
  window.dispatchEvent(new Event("resize"));
  window.scrollTo(0, 0);
});
await page.waitForTimeout(450);
await page.screenshot({ path: "/tmp/mobile-qa.png" });
console.log({ spaceId: task.spaceId });
EOF
```

## 4. 独立收尾脚本（`task.finish`）

按 `ego-browser` 契约，在本轮核验输出确认无误后，用**独立最后一次脚本调用**执行 `task.finish(...)`：

- **本地临时 QA 服务**：执行 `const task = await taskSpace(SPACE_ID); await task.finish({ keep: [] });`，随后终止临时 `node server/index.mjs` 进程并清理 `/tmp/yj-qa`。
- **线上生产站点（`https://jisuanqi.yjty.io`）**：执行 `const task = await taskSpace(SPACE_ID); await task.finish({ keep: ["p1"] });`，将已打开的生产页面留给用户直接查看。
