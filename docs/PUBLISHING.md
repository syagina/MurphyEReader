# 发布到 GitHub 前的检查清单

本文档记录 MurphyEReader 的 GitHub 发布流程与检查项。首次公开发布于
2026-11-17 完成（`v1.0.0`），当前版本 `v1.2.0`（2026-11-21）。后续版本
发布可沿用本清单。

## 1. 先决定发布范围

- [x] 仓库已确定为公开仓库。
- [x] 安装包通过 GitHub Releases 发布，不提交进 Git。
- [x] `docs/superpowers/` 与 `.superpowers/` 是本地开发资料，不进入公开仓库。
- [x] 本地 `tmp/`、`dist-next/`、`dist-review/` 等目录未发布。

## 2. 文件与 Git 历史扫描

首发前执行了定向扫描（`git status`、`git ls-files`、`git grep`、`git log -S`），
以下内容确认未进入仓库：

- [x] `node_modules/`、`out/`、`dist/`
- [x] `tmp/`、`.tmp-babeldoc/`、`.tmp-pdf/`
- [x] `%APPDATA%` 下的数据库、文献 PDF、笔记
- [x] `.env`、`*.pem`、`*.key`、`*.p12`
- [x] 真实 API Key、DeepSeek/其他服务商密钥

本次**未运行 gitleaks** 全量检测，只做了上述定向扫描；GitHub 的 Secret
Scanning 与 push protection 已开启，作为持续兜底。后续版本可补跑：

```bash
gitleaks detect --source . --redact --verbose
```

复查命令：

```bash
git status --porcelain -uall
git ls-files | grep -Ei '\.(db|sqlite|sqlite3|pdf|pem|key|p12|env)$'
git ls-files | grep -E '^(dist|out|node_modules|tmp|\.tmp-)'
git grep -nE 'sk-[A-Za-z0-9_-]{16,}|api[_-]?key|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|password'
git log -p --all -S 'sk-' -- .
```

如果发现密钥：

1. **先去服务商后台吊销/轮换密钥**；
2. 再决定是否用 `git filter-repo` 清理历史；
3. 仓库尚未推送时处理成本最低；已经推送后要假设密钥已泄露。

## 3. 许可证与第三方合规

- [x] `LICENSE` 已采用专有许可（保留所有权利）。
- [x] `package.json` 的 `license` 已改为 `UNLICENSED`。
- [x] `NOTICE.md` 已列出运行时依赖、BabelDOC 与 uv。
- [x] 安装包**没有**打包 BabelDOC 或 PyMuPDF；若未来打包，先评估 AGPL-3.0 义务。
- [x] `pdfjs-dist`（Apache-2.0）等第三方声明未被删除。
- [x] 图标、截图、测试 PDF 的使用权已确认。

## 4. 发布内容准备

- [x] `README.md` 已核对：功能、构建命令、数据位置、隐私说明与实际一致。
- [x] `build/icon.png` 已加入版本控制（README 顶部引用它）。
- [x] 截图放在 `docs/screenshots/`，且不包含真实密钥、论文正文或个人路径。
- [x] 版本号已确定为 `1.0.1`，并已同步 `package.json` 与 `package-lock.json`。
- [x] 安装包已用新名字/新图标重新构建：`npm run package`。
- [x] 安装包输出为 `dist/MurphyEReader-1.0.1-setup.exe`，不要提交进 Git。
- [x] 安装包 SHA-256：`9ee29f7146869d374457bd78f2c90724b222509f6c0d5def76def807468f3263`（未签名，首次运行可能触发 SmartScreen）。
- [x] 当前 `dist/` 下的旧版 `PaperLens-0.1.0-setup.exe` 未发布。

## 5. GitHub 仓库设置

- [x] 默认分支为 `main`。本地发布分支是 `impl/paperlens`，首次推送时映射为远程 `main`，未在本地合并 `main`。
- [x] 已填写仓库描述和 topics（Electron、PDF、AI、translation、paper-reading）。
- [x] 公开仓库已开启 **Secret Scanning** 与 **Dependabot alerts**。
- [x] 已开启 Private vulnerability reporting。
- [x] 安装包未提交进仓库；已在 Releases 中上传 `MurphyEReader-1.0.1-setup.exe`。
- [x] 发布 Release 时附上 SHA-256 校验值：

```powershell
Get-FileHash .\dist\MurphyEReader-1.0.1-setup.exe -Algorithm SHA256
```

## 6. 发布记录（已完成）

- [x] 远程：`https://github.com/syagina/MurphyEReader`
- [x] 本地发布分支 `impl/paperlens` 映射为远程 `main`，未在本地合并 `main`
- [x] 安装包未提交进 Git，已作为 Release 附件上传

| 版本 | 日期 | tag | 安装包 SHA-256 |
|---|---|---|---|
| 1.0.0 | 2026-11-17 | `v1.0.0` | `09ab7e88d11661bd8b5d76d89d92b8af32984c92406a01bc3a16f711332fd84a` |
| 1.0.1 | 2026-11-19 | `v1.0.1` | `9ee29f7146869d374457bd78f2c90724b222509f6c0d5def76def807468f3263` |
| 1.0.3 | 2026-11-19 | `v1.0.3` | `e0342b6320a87fb33ec5e66e434d9939deb492dd047823039b175f190311adc3` |
| 1.1.0 | 2026-11-20 | `v1.1.0` | `c19389ad86335546eccd6091abf06bf5176c087a178d31df3bf7bd690126ae6c` |
| 1.2.0 | 2026-11-21 | `v1.2.0` | `90ab33e8b3878db7e1b7cac64e5a7b195c505374c2a138813b3a1b7e35cae883` |

后续版本发布可沿用：

```powershell
git push origin impl/paperlens:main
git push origin vX.Y.Z
gh release create vX.Y.Z "dist/MurphyEReader-X.Y.Z-setup.exe" `
  --title "MurphyEReader X.Y.Z" `
  --notes "Windows x64 安装包。SHA-256: ..."
```

## 7. 如果之后要申请软著

- [x] 为发布的版本打 tag（`v1.0.0`、`v1.0.1`），保留提交历史。
- [x] 记录 GitHub 首次公开发布日期：2026-11-17。
- [ ] 申请版本尽量与某个 Release/tag 对应，避免源码、说明书、安装包不一致。
- [ ] 注意 2026 年新版申请表关于 AI 使用的诚信承诺，如实申报，不要签署与事实不符的声明。
