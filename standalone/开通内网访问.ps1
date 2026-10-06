$ErrorActionPreference = 'Stop'
$ruleName = 'DOON Order Workspace LAN 8787'
$nodePath = 'C:\Program Files\nodejs\node.exe'
$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) { throw '同名规则已存在，请先检查，不自动扩大已有规则。' }
New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8787 -LocalAddress 192.168.1.176 -RemoteAddress 192.168.1.0/24 -Program $nodePath -Profile Any -Description '度昂订单中台：只允许公司当前局域网访问 8787 端口' | Out-Null
$projectRoot = Split-Path $PSScriptRoot -Parent
'仅已允许 192.168.1.0/24 访问本机 192.168.1.176:8787。' | Set-Content -LiteralPath (Join-Path $projectRoot 'lan-data\firewall-ready.txt') -Encoding UTF8
