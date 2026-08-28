$ErrorActionPreference = "Stop"
Write-Host "未检测到 Node.js 20+，正在尝试通过 Windows Package Manager 自动安装 Node.js LTS..."
if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
  throw "当前Windows没有winget，无法自动安装Node.js。请将本日志发给开发者。"
}
winget install --id OpenJS.NodeJS.LTS --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
if ($LASTEXITCODE -ne 0) { throw "winget安装Node.js失败，退出码：$LASTEXITCODE" }
Write-Host "Node.js LTS安装完成。"
