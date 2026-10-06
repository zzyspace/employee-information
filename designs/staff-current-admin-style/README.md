# 员工中心 · 对齐现有后台风格

状态：已于 2026-09-26 部署正式页面，提交 b21bcebdcae29536bc71c9ebd11126f62cfd2abf。仅 public/portal.html 进入提交；本目录预览和虚构数据未发布。生产 SHA、页面哈希、健康与登录保护检查通过，未重启服务。

实际修改：`../../public/portal.html` 的 CSS。HTML 结构、文案、ID 和全部 JavaScript 保持不变。

样式参考：`../../../invoice-submit/public/admin.html`、`../../../wechat-claw/src/admin/public/admin.html` 和 `../../../store-management/public/assets/style.css`。复用当前正式后台的蓝灰渐变、浅色/深色主题、28px 面板圆角、46px 筛选控件和阴影。员工的桌面表格、手机卡片、详情抽屉、附件、历史版本、编辑和回收站保持原有流程；保留已确认的顶部栏控件和菜单定位。

## 本地预览

在本项目根目录运行：

```sh
node designs/staff-current-admin-style/preview-server.cjs server
```

打开 http://127.0.0.1:8798/staff 。只使用内置虚构员工和示意附件，不连接线上接口或数据库，写入请求返回 405。

## 验收

- 静态校验及现有 17 项测试通过。
- 320/390/768/1440px × 浅色/深色，共 8 组交互检查通过：列表、搜索、门店筛选、状态/回收站、详情、历史、附件、进入编辑及退出、后台菜单开关。
- 12 组改动前后的顶部栏控件样式比较通过；菜单位置和遮罩正常。
- 浏览器无页面横向溢出、无脚本/控制台报错，无外部网络请求或业务写入。
- 所有截图和完整检查记录保存在 `previews/`。手机结果为 Chrome 视口模拟，尚未进行手机真机验证。
