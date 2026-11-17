# 发布到 GitHub 前的检查清单

本文档用于把 MurphyEReader 首次发布到 GitHub（公开或私有）前的自查。
当前仓库在 `impl/paperlens` 分支，且存在大量未提交改动；**未经确认不要直接
提交或推送**。

## 1. 先决定发布范围

- [ ] 仓库公开还是私有？
- [ ] 是否同时发布安装包？（建议放到 GitHub Releases，而不是提交进 Git）
- [ ] `docs/superpowers/` 里的设计/计划文档是否要公开？其中可能包含开发过程、
      AI 协作记录或内部决策，建议先逐篇检查。
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
- [ ] 版本号已确定（如 `1.0.0`），并同步 `package.json`。
- [ ] 安装包已用新名字/新图标重新构建：`npm run package`。
- [ ] 安装包输出为 `dist/MurphyEReader-<version>-setup.exe`，不要提交进 Git。
- [ ] 当前 `dist/` 下旧版 `PaperLens-0.1.0-setup.exe` 不要发布。

## 5. GitHub 仓库设置

- [ ] 创建仓库后设置默认分支（建议 `main`；当前分支是 `impl/paperlens`）。
- [ ] 填写仓库描述和 topics（Electron、PDF、AI、translation、paper-reading）。
- [ ] 公开仓库开启 **Secret Scanning** 与 **Dependabot alerts**。
- [ ] 如需接收漏洞报告，开启 Private vulnerability reporting。
- [ ] 不把安装包提交进仓库；在 Releases 中上传 `MurphyEReader-<version>-setup.exe`。
- [ ] 发布 Release 时附上 SHA-256 校验值：

```powershell
Get-FileHash .\dist\MurphyEReader-1.0.0-setup.exe -Algorithm SHA256
```

## 6. 提交与推送（需本人确认）

确认无误后，再显式添加需要发布的文件，避免 `git add -A` 误收本地文件：

```bash
git add README.md LICENSE NOTICE.md docs/PUBLISHING.md .gitignore package.json package-lock.json
git status
git commit -m "docs: add project documentation and proprietary license"
```

推送前再次确认分支与远程：

```bash
git remote -v
git branch --show-current
```

- [ ] 确认远程地址是目标仓库。
- [ ] 确认没有把私有数据推上去。
- [ ] 首次推送后检查 GitHub 的 Secret Scanning 结果。

## 7. 如果之后要申请软著

- [ ] 为发布的版本打 tag（如 `v1.0.0`），保留提交历史。
- [ ] 记录 GitHub 首次公开发布日期（申请表中的“首次发表日期”）。
- [ ] 申请版本尽量与某个 Release/tag 对应，避免源码、说明书、安装包不一致。
- [ ] 注意 2026 年新版申请表关于 AI 使用的诚信承诺，如实申报，不要签署与事实不符的声明。
