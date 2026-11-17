# 发布到 GitHub 前的检查清单

本文档用于把 MurphyEReader 首次发布到 GitHub（公开或私有）前的自查。
当前发布 tag 为 `v1.0.0`，工作区干净；推送动作仍需本人确认。公开推送会
一并公开完整的 Git 提交历史。

## 1. 先决定发布范围

- [ ] 仓库公开还是私有？
- [ ] 是否同时发布安装包？（建议放到 GitHub Releases，而不是提交进 Git）
- [x] `docs/superpowers/` 与 `.superpowers/` 是本地开发资料，不进入公开仓库。
- [ ] 是否保留 `tmp/`、`dist-next/`、`dist-review/` 等本地目录？（这些不应发布）

## 2. 文件与 Git 历史扫描

先看当前工作区和未跟踪文件：

```bash
git status --porcelain -uall
git ls-files | grep -Ei '\.(db|sqlite|sqlite3|pdf|pem|key|p12|env)$'
git ls-files | grep -E '^(dist|out|node_modules|tmp|\.tmp-)'
```

确认以下内容**没有**被跟踪：

- [ ] `node_modules/`、`out/`、`dist/`
- [ ] `tmp/`、`.tmp-babeldoc/`、`.tmp-pdf/`
- [ ] `%APPDATA%` 下的数据库、文献 PDF、笔记
- [ ] `.env`、`*.pem`、`*.key`、`*.p12`
- [ ] 真实 API Key、DeepSeek/其他服务商密钥

扫描当前文件：

```bash
git grep -nE 'sk-[A-Za-z0-9_-]{16,}|api[_-]?key|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|password'
```

扫描全部历史（密钥可能只在旧提交里）：

```bash
git log -p --all -S 'sk-' -- .
```

建议安装 gitleaks 做完整检测：

```bash
gitleaks detect --source . --redact --verbose
```

如果发现密钥：

1. **先去服务商后台吊销/轮换密钥**；
2. 再决定是否用 `git filter-repo` 清理历史；
3. 仓库尚未推送时处理成本最低；已经推送后要假设密钥已泄露。

## 3. 许可证与第三方合规

- [ ] `LICENSE` 已采用专有许可（保留所有权利）。
- [ ] `package.json` 的 `license` 已改为 `UNLICENSED`。
- [ ] `NOTICE.md` 已列出运行时依赖、BabelDOC 与 uv。
- [ ] 安装包**没有**打包 BabelDOC 或 PyMuPDF；若未来打包，先评估 AGPL-3.0 义务。
- [ ] `pdfjs-dist`（Apache-2.0）等第三方声明未被删除。
- [ ] 图标、截图、测试 PDF 的使用权已确认。

## 4. 发布内容准备

- [ ] `README.md` 已核对：功能、构建命令、数据位置、隐私说明与实际一致。
- [ ] `build/icon.png` 已加入版本控制（README 顶部引用它）。
- [ ] 截图放在 `docs/screenshots/`，且不包含真实密钥、论文正文或个人路径。
- [x] 版本号已确定为 `1.0.0`，并已同步 `package.json`。
- [x] 安装包已用新名字/新图标重新构建：`npm run package`。
- [x] 安装包输出为 `dist/MurphyEReader-1.0.0-setup.exe`，不要提交进 Git。
- [x] 安装包 SHA-256：`09ab7e88d11661bd8b5d76d89d92b8af32984c92406a01bc3a16f711332fd84a`（未签名，首次运行可能触发 SmartScreen）。
- [ ] 当前 `dist/` 下旧版 `PaperLens-0.1.0-setup.exe` 不要发布。

## 5. GitHub 仓库设置

- [ ] 创建仓库后设置默认分支（建议 `main`）。本地发布分支是 `impl/paperlens`，首次推送时映射为远程 `main`，未在本地合并 `main`。
- [ ] 填写仓库描述和 topics（Electron、PDF、AI、translation、paper-reading）。
- [ ] 公开仓库开启 **Secret Scanning** 与 **Dependabot alerts**。
- [ ] 如需接收漏洞报告，开启 Private vulnerability reporting。
- [ ] 不把安装包提交进仓库；在 Releases 中上传 `MurphyEReader-<version>-setup.exe`。
- [ ] 发布 Release 时附上 SHA-256 校验值：

```powershell
Get-FileHash .\dist\MurphyEReader-1.0.0-setup.exe -Algorithm SHA256
```

## 6. 推送（需本人确认）

发布提交和 tag 已在本机创建，尚未配置远程、尚未推送。确认无误后执行：

```powershell
# 1. 重新登录（当前 keyring 里的 token 已失效），确认账号是 syagina
gh auth login -h github.com

# 2. 创建空仓库并添加 origin；不要勾选 README/LICENSE/gitignore
gh repo create MurphyEReader --public --source . --remote origin

# 3. 首次推送：本地发布分支映射为远程 main，不涉及本地合并
git push -u origin impl/paperlens:main
git push origin v1.0.0
```

如果已在网页创建空仓库，第 2 步改用：

```powershell
git remote add origin https://github.com/syagina/MurphyEReader.git
```

推送前再次确认分支与远程：

```bash
git remote -v
git branch --show-current
```

- [ ] 确认远程地址是目标仓库。
- [ ] 确认没有把私有数据推上去。
- [ ] 确认 GitHub 默认分支为 `main`。
- [ ] 首次推送后检查 GitHub 的 Secret Scanning 结果。
- [ ] 在 Releases 上传 `dist/MurphyEReader-1.0.0-setup.exe`，不要提交进 Git。

## 7. 如果之后要申请软著

- [ ] 为发布的版本打 tag（如 `v1.0.0`），保留提交历史。
- [ ] 记录 GitHub 首次公开发布日期（申请表中的“首次发表日期”）。
- [ ] 申请版本尽量与某个 Release/tag 对应，避免源码、说明书、安装包不一致。
- [ ] 注意 2026 年新版申请表关于 AI 使用的诚信承诺，如实申报，不要签署与事实不符的声明。
