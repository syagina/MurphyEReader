import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CommandInvocation } from '@shared/types';

/**
 * The app-managed engine lives under the current user's local app data. The
 * folder name predates the MurphyEReader rename; keeping it lets an existing
 * one-click install keep working after the update.
 */
export const MANAGED_ENGINE_FOLDER = join('PaperLens', 'translation-engine');
export const MANAGED_UV_VERSION = '0.13.8';
export const MANAGED_UV_SHA256 =
  '529e78a9cec6cd7e3e014f7ecd8bda0c113969d4ed0f2efeedb85c30943325b8';
export const MANAGED_BABELDOC_PACKAGE = 'BabelDOC==0.7.1';

/**
 * uv's official download host works without GitHub access. The USTC mirror is
 * the fallback for networks where the official host is blocked or slow.
 */
const UV_DOWNLOAD_URLS = [
  `https://releases.astral.sh/github/uv/releases/download/${MANAGED_UV_VERSION}/uv-x86_64-pc-windows-msvc.zip`,
  `https://mirrors.ustc.edu.cn/github-release/astral-sh/uv/${MANAGED_UV_VERSION}/uv-x86_64-pc-windows-msvc.zip`,
];

export interface ManagedEnginePaths {
  installRoot: string;
  uvDir: string;
  uvPath: string;
  toolDir: string;
  binDir: string;
  pythonDir: string;
  cacheDir: string;
  babeldocPath: string;
  logPath: string;
  resultPath: string;
  scriptPath: string;
  configPath: string;
}

export interface BabeldocInstallPlan {
  paths: ManagedEnginePaths;
  command: CommandInvocation;
}

export interface BabeldocInstallOutcome {
  ok: boolean;
  canceled: boolean;
  babeldocPath: string | null;
  message: string | null;
}

export interface BabeldocInstallerOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Directory for the generated script/config; defaults to the OS temp dir. */
  tempDir?: string;
}

interface InstallerConfig {
  installRoot: string;
  uvPath: string;
  logPath: string;
  resultPath: string;
  userProfile: string;
  home: string;
  appData: string;
  localAppData: string;
  httpProxy: string;
  httpsProxy: string;
  allProxy: string;
  noProxy: string;
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = (value ?? '').trim();
    if (trimmed !== '') {
      return trimmed;
    }
  }
  return '';
}

/** Resolves every path the elevated installer must write to. */
export function resolveManagedEnginePaths(
  env: NodeJS.ProcessEnv,
  jobId: string,
  tempDir?: string,
): ManagedEnginePaths {
  const base = firstNonEmpty(env.LOCALAPPDATA, env.USERPROFILE, tmpdir());
  const installRoot = join(base, MANAGED_ENGINE_FOLDER);
  const uvDir = join(installRoot, 'uv');
  const binDir = join(installRoot, 'bin');
  const scriptDir = join(
    firstNonEmpty(tempDir, tmpdir()),
    `paperlens-babeldoc-install-${jobId}`,
  );
  return {
    installRoot,
    uvDir,
    uvPath: join(uvDir, 'uv.exe'),
    toolDir: join(installRoot, 'tool'),
    binDir,
    pythonDir: join(installRoot, 'python'),
    cacheDir: join(installRoot, 'cache'),
    babeldocPath: join(binDir, 'babeldoc.exe'),
    logPath: join(installRoot, 'install.log'),
    resultPath: join(installRoot, 'install-result.json'),
    scriptPath: join(scriptDir, 'install.ps1'),
    configPath: join(scriptDir, 'install-config.json'),
  };
}

function psSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function psStringArray(values: string[]): string {
  return `@(${values.map((value) => psSingleQuoted(value)).join(', ')})`;
}

/**
 * The elevated script. The first process always relaunches the same file with
 * `Start-Process -Verb RunAs` (except for the marked child or an unattended
 * test), so a visible PowerShell window shows the downloads and the install
 * still runs with administrator rights when the app itself was elevated.
 *
 * It deliberately installs into the invoking user's LOCALAPPDATA. The
 * elevation is requested because installer downloads and antivirus/network
 * policy often require it on managed Windows machines, but no system Python,
 * PATH entry, or shared environment is modified.
 */
export function buildInstallScript(): string {
  return `
param(
  [switch]$NoElevate,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$scriptDir = Split-Path -Parent $PSCommandPath
$configPath = Join-Path $scriptDir 'install-config.json'
if (-not (Test-Path -LiteralPath $configPath)) {
  Write-Error '安装配置文件缺失，无法继续。'
  exit 10
}
$config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json

$installRoot = [string]$config.installRoot
$logPath = [string]$config.logPath
$resultPath = [string]$config.resultPath
$uvDir = Join-Path $installRoot 'uv'
$toolDir = Join-Path $installRoot 'tool'
$binDir = Join-Path $installRoot 'bin'
$pythonDir = Join-Path $installRoot 'python'
$cacheDir = Join-Path $installRoot 'cache'
$babeldocExe = Join-Path $binDir 'babeldoc.exe'
$uvExe = [string]$config.uvPath

New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
Set-Content -LiteralPath $logPath -Value '' -Encoding UTF8

function Write-Log([string]$Message) {
  $line = '[{0:HH:mm:ss}] {1}' -f (Get-Date), $Message
  Write-Host $line
  try {
    Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
  } catch {
  }
}

function Write-Result([bool]$Ok, [string]$Message, [bool]$Canceled = $false) {
  $payload = [ordered]@{
    ok = $Ok
    canceled = $Canceled
    message = $Message
    babeldocPath = $(if (Test-Path -LiteralPath $babeldocExe) { $babeldocExe } else { $null })
    uvPath = $(if ($uvExe -and (Test-Path -LiteralPath $uvExe)) { $uvExe } else { $null })
    installedAt = (Get-Date).ToString('o')
  }
  try {
    $json = $payload | ConvertTo-Json -Depth 3
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($resultPath, $json, $encoding)
  } catch {
  }
}

try {
  if ($config.userProfile) { $env:USERPROFILE = [string]$config.userProfile }
  if ($config.home) { $env:HOME = [string]$config.home }
  if ($config.appData) { $env:APPDATA = [string]$config.appData }
  if ($config.localAppData) { $env:LOCALAPPDATA = [string]$config.localAppData }
  if ($config.httpProxy) { $env:HTTP_PROXY = [string]$config.httpProxy }
  if ($config.httpsProxy) { $env:HTTPS_PROXY = [string]$config.httpsProxy }
  if ($config.allProxy) { $env:ALL_PROXY = [string]$config.allProxy }
  if ($config.noProxy) { $env:NO_PROXY = [string]$config.noProxy }

  Write-Log 'MurphyEReader 翻译引擎一键安装'
  Write-Log "安装位置：$installRoot"

  if (-not $NoElevate) {
    Write-Result $false '安装尚未完成'
    Write-Host '正在请求管理员权限，请在 Windows 提示中点击“是”。'
    $argList = '-NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -NoElevate'
    try {
      $elevated = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe') -Verb RunAs -WindowStyle Normal -PassThru -ArgumentList $argList
      $elevated.WaitForExit()
      exit $elevated.ExitCode
    } catch {
      $reason = $_.Exception.Message
      if ($reason -match '取消|cancel') {
        $message = '已取消管理员授权，安装未开始'
        Write-Log $message
        Write-Result $false $message $true
      } else {
        $message = '无法启动管理员安装窗口：' + $reason
        Write-Log $message
        Write-Result $false $message
      }
      if (-not $NoPause) { Start-Sleep -Seconds 8 }
      exit 2
    }
  }

  Write-Result $false '安装正在进行'
  $workTemp = Join-Path $installRoot 'temp'
  New-Item -ItemType Directory -Force -Path $uvDir, $toolDir, $binDir, $pythonDir, $cacheDir, $workTemp | Out-Null
  $env:TEMP = $workTemp
  $env:TMP = $workTemp

  function Download-File([string[]]$Urls, [string]$Destination, [string]$Sha256) {
    foreach ($url in $Urls) {
      try {
        Write-Log "下载：$url"
        Invoke-WebRequest -Uri $url -OutFile $Destination -UseBasicParsing -TimeoutSec 300
        $actual = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $Sha256.ToLowerInvariant()) {
          throw "SHA256 校验失败（期望 $Sha256，实际 $actual）"
        }
        Write-Log '下载完成，校验通过。'
        return $true
      } catch {
        Write-Log ('下载失败：' + $_.Exception.Message)
        Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
      }
    }
    return $false
  }

  function Install-ManagedUv {
    $managedUv = Join-Path $uvDir 'uv.exe'
    Remove-Item -LiteralPath $managedUv -Force -ErrorAction SilentlyContinue
    Write-Log '正在下载 uv 0.13.8…'
    $zipPath = Join-Path $env:TEMP ('paperlens-uv-' + [Guid]::NewGuid().ToString('N') + '.zip')
    $downloadOk = Download-File ${psStringArray(UV_DOWNLOAD_URLS)} $zipPath ${psSingleQuoted(MANAGED_UV_SHA256)}
    if (-not $downloadOk) {
      throw '无法下载 uv。请检查网络、代理或防火墙设置。'
    }
    $extractDir = Join-Path $uvDir 'extract'
    Remove-Item -LiteralPath $extractDir -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $extractDir)
    $foundUv = Get-ChildItem -LiteralPath $extractDir -Recurse -Filter 'uv.exe' | Select-Object -First 1
    if ($null -eq $foundUv) {
      throw 'uv 压缩包内容异常。'
    }
    Move-Item -LiteralPath $foundUv.FullName -Destination $managedUv -Force
    Remove-Item -LiteralPath $extractDir -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
    return $managedUv
  }

  if ($uvExe -and (Test-Path -LiteralPath $uvExe)) {
    Write-Log "使用已安装的 uv：$uvExe"
  } else {
    $uvExe = Install-ManagedUv
    Write-Log "uv 已就绪：$uvExe"
  }

  & $uvExe --version
  if ($LASTEXITCODE -ne 0) {
    Write-Log '现有 uv 无法运行，改用重新下载的托管版本…'
    $uvExe = Install-ManagedUv
    & $uvExe --version
    if ($LASTEXITCODE -ne 0) {
      throw 'uv 无法运行。'
    }
  }

  $env:UV_TOOL_DIR = $toolDir
  $env:UV_TOOL_BIN_DIR = $binDir
  $env:UV_PYTHON_INSTALL_DIR = $pythonDir
  $env:UV_CACHE_DIR = $cacheDir
  $env:UV_HTTP_TIMEOUT = '600'
  $env:UV_CONCURRENT_DOWNLOADS = '8'
  $env:UV_NO_MODIFY_PATH = '1'

  $sources = @(
    @{ Name = '阿里云 PyPI + npmmirror Python'; Index = 'https://mirrors.aliyun.com/pypi/simple'; Python = 'https://registry.npmmirror.com/-/binary/python-build-standalone' },
    @{ Name = '中科大 PyPI + GitHub Release 镜像'; Index = 'https://mirrors.ustc.edu.cn/pypi/simple'; Python = 'https://mirrors.ustc.edu.cn/github-release/astral-sh/python-build-standalone' },
    @{ Name = '官方源'; Index = 'https://pypi.org/simple'; Python = '' }
  )

  $installed = $false
  foreach ($source in $sources) {
    Write-Log ('尝试安装源：' + $source.Name)
    $env:UV_DEFAULT_INDEX = $source.Index
    if ($source.Python) {
      $env:UV_PYTHON_INSTALL_MIRROR = $source.Python
    } else {
      Remove-Item Env:UV_PYTHON_INSTALL_MIRROR -ErrorAction SilentlyContinue
    }
    & $uvExe tool install --force --no-config --managed-python --python 3.12 'BabelDOC==0.7.1'
    if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $babeldocExe)) {
      $installed = $true
      break
    }
    Write-Log '该安装源未成功，尝试下一个…'
  }

  if (-not $installed) {
    throw '所有安装源均未能完成安装。请检查网络或代理后重试。'
  }

  Write-Log 'BabelDOC 已安装，正在验证…'
  & $babeldocExe --version
  if ($LASTEXITCODE -ne 0) {
    throw 'BabelDOC 安装后无法运行。'
  }

  try {
    Write-Log '清理安装缓存…'
    & $uvExe cache clean --quiet
  } catch {
    Write-Log ('缓存清理失败（不影响使用）：' + $_.Exception.Message)
  }
  Remove-Item -LiteralPath $workTemp -Recurse -Force -ErrorAction SilentlyContinue

  Write-Log '安装完成。现在可以关闭此窗口。'
  Write-Result $true '安装完成'
  if (-not $NoPause) { Start-Sleep -Seconds 8 }
  exit 0
} catch {
  $message = '安装失败：' + $_.Exception.Message
  Write-Log $message
  Write-Result $false $message
  if (-not $NoPause) { Start-Sleep -Seconds 30 }
  exit 3
}
`.trimStart();
}

/** Builds the PowerShell invocation the tool runner executes. */
export function buildInstallCommand(scriptPath: string): CommandInvocation {
  return {
    file: 'powershell.exe',
    args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
  };
}

/**
 * Creates the self-elevating script and its JSON config. The config carries
 * every path so the elevated process never falls back to the administrator's
 * own profile (which may be a different Windows account).
 */
export class BabeldocInstaller {
  private readonly env: NodeJS.ProcessEnv;
  private readonly platform: NodeJS.Platform;
  private readonly tempDir: string | undefined;

  constructor(options: BabeldocInstallerOptions = {}) {
    this.env = options.env ?? process.env;
    this.platform = options.platform ?? process.platform;
    this.tempDir = options.tempDir;
  }

  prepare(jobId: string, uvPath: string | null): BabeldocInstallPlan {
    const paths = resolveManagedEnginePaths(this.env, jobId, this.tempDir);
    mkdirSync(paths.installRoot, { recursive: true });
    mkdirSync(dirname(paths.scriptPath), { recursive: true });
    // A stale success file must never make a failed run look successful.
    rmSync(paths.resultPath, { force: true });
    rmSync(paths.logPath, { force: true });

    const config: InstallerConfig = {
      installRoot: paths.installRoot,
      uvPath: uvPath ?? '',
      logPath: paths.logPath,
      resultPath: paths.resultPath,
      userProfile: firstNonEmpty(this.env.USERPROFILE),
      home: firstNonEmpty(this.env.HOME, this.env.USERPROFILE),
      appData: firstNonEmpty(this.env.APPDATA),
      localAppData: firstNonEmpty(this.env.LOCALAPPDATA),
      httpProxy: firstNonEmpty(this.env.HTTP_PROXY, this.env.http_proxy),
      httpsProxy: firstNonEmpty(this.env.HTTPS_PROXY, this.env.https_proxy),
      allProxy: firstNonEmpty(this.env.ALL_PROXY, this.env.all_proxy),
      noProxy: firstNonEmpty(this.env.NO_PROXY, this.env.no_proxy),
    };

    writeFileSync(
      paths.configPath,
      `${JSON.stringify(config, null, 2)}\n`,
      'utf8',
    );
    // Windows PowerShell 5.1 reads a BOM-less .ps1 as ANSI; without the BOM the
    // Chinese progress lines become mojibake in the elevated window.
    writeFileSync(
      paths.scriptPath,
      `${String.fromCharCode(0xfeff)}${buildInstallScript()}`,
      'utf8',
    );
    return { paths, command: buildInstallCommand(paths.scriptPath) };
  }

  readOutcome(plan: BabeldocInstallPlan): BabeldocInstallOutcome | null {
    if (this.platform !== 'win32' || !existsSync(plan.paths.resultPath)) {
      return null;
    }
    try {
      const raw = readFileSync(plan.paths.resultPath, 'utf8');
      const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
      const parsed = JSON.parse(text) as Record<string, unknown>;
      return {
        ok: parsed.ok === true,
        canceled: parsed.canceled === true,
        babeldocPath:
          typeof parsed.babeldocPath === 'string' && parsed.babeldocPath !== ''
            ? parsed.babeldocPath
            : null,
        message: typeof parsed.message === 'string' ? parsed.message : null,
      };
    } catch {
      return null;
    }
  }
}
