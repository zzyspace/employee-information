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
- 提交前必须添加财务微信、备注真实姓名与门店名称，并勾选完成确认。
- 支持 JPG、PNG、HEIC、HEIF、PDF，每个文件最大 20MB。
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
- Nginx snippet：`/etc/nginx/snippets/employee-information.locations.conf`
- 共享后台凭据：`/etc/invoice-submit.env`

Nginx 对 `/employee/` 的请求体上限为 65MB，允许一次提交三个 20MB 文件并保留 multipart 开销。

## 部署材料

仓库提供：

- `deploy/systemd/employee-information.service`
- `deploy/nginx/employee-information.locations.conf`
- `deploy/deploy-employee-information.sh`

部署脚本只会给现有 `invoice-submit` Nginx site 添加 snippet include，不会用本项目配置覆盖整个站点。服务器必须已经存在 `/opt/employee-information/current` Git checkout。

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
