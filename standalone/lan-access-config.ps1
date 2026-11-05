# Pure configuration validation. Dot-sourcing this file does not contact a server
# or change firewall, deployment, service, data, or environment configuration.
function Resolve-DoonLanOrigin {
    param([AllowNull()][AllowEmptyString()][string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { throw 'Set DOON_LAN_URL to the authorized LAN HTTP(S) origin before deployment.' }
    $raw = $Value.Trim()
    $uri = $null
    if ($raw -notmatch '^https?://[^/\?#\\\s@]+/?$' -or
        -not [Uri]::TryCreate($raw, [UriKind]::Absolute, [ref]$uri) -or
        $uri.Scheme -notin @('http', 'https') -or -not $uri.Host -or
        $uri.UserInfo -or $uri.AbsolutePath -ne '/' -or $uri.Query -or $uri.Fragment -or
        $uri.Port -lt 1 -or $uri.Port -gt 65535) {
        throw 'DOON_LAN_URL must be an HTTP(S) origin without credentials, path, query, or fragment.'
    }
    return $uri.GetLeftPart([UriPartial]::Authority)
}

function ConvertTo-DoonPrivateIPv4 {
    param([AllowNull()][AllowEmptyString()][string]$Value)
    if ($Value -notmatch '^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$') {
        throw 'An explicit canonical private IPv4 address is required.'
    }
    $octets = @($Value.Split('.') | ForEach-Object { [int]$_ })
    if (@($octets | Where-Object { $_ -gt 255 }).Count -or
        -not ($octets[0] -eq 10 -or
              ($octets[0] -eq 172 -and $octets[1] -ge 16 -and $octets[1] -le 31) -or
              ($octets[0] -eq 192 -and $octets[1] -eq 168))) {
        throw 'Only an explicit RFC1918 private IPv4 address is allowed.'
    }
    return [uint64]($octets[0] * 16777216L + $octets[1] * 65536L + $octets[2] * 256L + $octets[3])
}

function Resolve-DoonLanFirewallScope {
    param(
        [AllowNull()][AllowEmptyString()][string]$LocalAddress,
        [AllowNull()][AllowEmptyString()][string]$AuthorizedSubnet
    )
    $localNumber = ConvertTo-DoonPrivateIPv4 -Value $LocalAddress
    if ($AuthorizedSubnet -notmatch '^([^/]+)/([0-9]{1,2})$') { throw 'AuthorizedSubnet must be one explicit IPv4 CIDR; Any, lists and ranges are not accepted.' }
    $networkAddress = $Matches[1]
    $prefix = [int]$Matches[2]
    # The former rule authorized a /24. Parameterization must not widen that scope.
    if ($prefix -lt 24 -or $prefix -gt 32 -or $AuthorizedSubnet -ne ($networkAddress + '/' + $prefix)) {
        throw 'AuthorizedSubnet must be a canonical /24 through /32 subnet, no broader than the former rule.'
    }
    $networkNumber = ConvertTo-DoonPrivateIPv4 -Value $networkAddress
    $mask = [uint64](4294967296L - [math]::Pow(2, 32 - $prefix))
    if (($networkNumber -band $mask) -ne $networkNumber) { throw 'AuthorizedSubnet must use its network address.' }
    if (($localNumber -band $mask) -ne $networkNumber) { throw 'LocalAddress must be within the authorized subnet.' }
    return [pscustomobject]@{ LocalAddress = $LocalAddress; AuthorizedSubnet = $AuthorizedSubnet }
}
