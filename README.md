# Employee Information

新员工入职信息收集与管理系统。项目采用与 `invoice-submit` 相同的轻量技术路线：Express、SQLite、Multer 和原生 HTML/CSS/JavaScript。

## 页面与接口

员工页面：

- `/employee/fuzzy`
- `/employee/fuzzy_qz`
- `/employee/peanut`

管理后台：

- `/employee/portal`
- 使用 `INVOICE_ADMIN_USERNAME` 和 `INVOICE_ADMIN_PASSWORD`，与发票后台共用 Basic Auth 凭据。
- 未配置完整凭据时，后台页面和接口返回 `503`。

健康检查：

- `/employee/healthz`

## 业务规则

- 姓名必填，最长 50 个字符。
- 手机号必须是有效的中国大陆 11 位手机号。
- 岗位必选，支持前厅和后厨。
- 身份证正面、反面必填，健康证选填。
- 提交时使用与 `wechat-claw` 报账识别相同的模型配置识别身份证正面；识别出通过校验的 18 位身份证号时写入该字段，识别失败不影响员工记录和附件保存。
- 提交前必须添加财务微信、备注真实姓名与门店名称，并勾选完成确认。
- 支持 JPG、PNG、HEIC、HEIF、PDF，每个文件最大 20MB。
- 后台使用本地 PDF.js 渲染 PDF 首页并裁去大面积空白后居中预览；原文件保持不变且不发送到第三方预览服务。
- 自动修复部分移动浏览器上传中文文件名时产生的 UTF-8/Latin-1 乱码，已有乱码记录也会在读取时兼容显示。
- 门店由页面路径决定，公开页面没有门店选择器。
- 相同手机号可以重复提交，每次生成独立记录。

## 历史与回收站

- 创建、编辑、删除、恢复都会生成不可变版本快照。
- 替换或移除附件不会删除旧文件；历史版本可以继续查看原附件。
- 历史版本只读，不能恢复到某个旧版本。
- 删除是软删除。已删除记录默认隐藏，可以在后台筛选并恢复。
- 不提供永久删除或自动历史清理功能。

历史会持续占用磁盘空间，备份或迁移时必须同时处理数据库和整个附件目录。

## 本地运行

```bash
npm install
INVOICE_ADMIN_USERNAME=admin \
INVOICE_ADMIN_PASSWORD=replace-with-a-strong-password \
npm run dev
```

打开：

```text
http://127.0.0.1:8789/employee/fuzzy
http://127.0.0.1:8789/employee/portal
```

本地数据默认写入 `.data/`。可通过 `EMPLOYEE_INFORMATION_DATA_ROOT` 修改。

## 身份证识别模型

服务默认直接复用 `wechat-claw` 的以下环境变量：

```text
WECHATY_REIMBURSEMENT_EXTRACTION_PROVIDER
WECHATY_REIMBURSEMENT_EXTRACTION_MODEL
WECHATY_REIMBURSEMENT_EXTRACTION_API_KEY
WECHATY_REIMBURSEMENT_EXTRACTION_BASE_URL
WECHATY_REIMBURSEMENT_OPENAI_PROXY_URL
```

生产服务会额外加载 `wechat-claw` 使用的 `/etc/wechat-claw.env`，从而读取同一组模型配置；`/etc/invoice-submit.env` 仍只用于共享后台凭据。需要单独切换员工系统时，可用 `EMPLOYEE_INFORMATION_ID_CARD_MODEL_PROVIDER`、`EMPLOYEE_INFORMATION_ID_CARD_MODEL_NAME`、`EMPLOYEE_INFORMATION_ID_CARD_MODEL_API_KEY`、`EMPLOYEE_INFORMATION_ID_CARD_MODEL_BASE_URL`、`EMPLOYEE_INFORMATION_ID_CARD_MODEL_PROXY_URL` 覆盖。模型请求失败、结果缺失或身份证校验码/出生日期不合法时，员工记录和附件仍会保存，`identity_card_number` 保持为空。

## 验证

```bash
npm run build
npm test
```

测试覆盖门店路由、字段和文件校验、20MB 边界、三文件上传、后台认证、编辑历史、旧附件留存、回收站与恢复、事务失败文件回收。

## 生产目录

- 代码：`/opt/employee-information/current`
- 数据库和附件：`/var/lib/employee-information`
- 服务：`employee-information.service`
- Node 监听：`127.0.0.1:8789`
- Nginx 路由：由独立的 `server-infra` 项目统一管理
- 共享后台凭据：`/etc/invoice-submit.env`
- 共享 `wechat-claw` 模型配置：`/etc/wechat-claw.env`

Nginx 对 `/employee/` 的请求体上限为 65MB，允许一次提交三个 20MB 文件并保留 multipart 开销。

## 部署材料

仓库提供：

- `deploy/systemd/employee-information.service`
- `deploy/nginx/employee-information.locations.conf`（迁移前兼容快照）
- `deploy/deploy-employee-information.sh`

部署脚本只管理应用依赖、systemd 服务和健康检查，不写入或 reload Nginx。
服务器必须已经存在 `/opt/employee-information/current` Git checkout；共享入口由
`server-infra` 独立发布。

本轮没有执行生产部署。

## 备份

服务停止或数据库完成一致性快照后，同时备份：

```text
/var/lib/employee-information/data/
/var/lib/employee-information/uploads/
```

只备份 SQLite 而遗漏附件目录，历史版本将无法查看文件。

## HTTP 风险

当前目标入口使用公网 HTTP。身份证、健康证、手机号以及 Basic Auth 密码在 HTTP 传输过程中没有加密；`no-store`、文件权限和后台鉴权无法消除这一风险。正式收集真实资料前应优先配置 HTTPS。
