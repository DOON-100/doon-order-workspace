param(
    [Parameter(Mandatory=$true)][string]$LocalAddress,
    [Parameter(Mandatory=$true)][string]$AuthorizedSubnet,
    [ValidateNotNullOrEmpty()][ValidateCount(1,2)][ValidateSet('Private','Domain')][string[]]$Profile = @('Private')
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lan-access-config.ps1')
$scope = Resolve-DoonLanFirewallScope -LocalAddress $LocalAddress -AuthorizedSubnet $AuthorizedSubnet
$ruleName = 'DOON Order Workspace LAN 8787'
$nodePath = 'C:\Program Files\nodejs\node.exe'
$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) { throw '同名规则已存在，请先检查，不自动扩大已有规则。' }
$assigned = @(Get-NetIPAddress -AddressFamily IPv4 -IPAddress $scope.LocalAddress -ErrorAction Stop | Where-Object { $_.AddressState -eq 'Preferred' })
if (-not $assigned.Count) { throw '指定的本机 IPv4 地址未在本机启用，未修改防火墙。' }
if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) { throw '未找到已配置的 Node 程序，未修改防火墙。' }
New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8787 -LocalAddress $scope.LocalAddress -RemoteAddress $scope.AuthorizedSubnet -Program $nodePath -Profile $Profile -Description '度昂订单中台：仅允许显式授权局域网范围访问 8787 端口' | Out-Null
$projectRoot = Split-Path $PSScriptRoot -Parent
('仅已允许 {0} 访问本机 {1}:8787；网络配置文件：{2}。' -f $scope.AuthorizedSubnet, $scope.LocalAddress, ($Profile -join ',')) | Set-Content -LiteralPath (Join-Path $projectRoot 'lan-data\firewall-ready.txt') -Encoding UTF8
