function Get-XdkLinkIgnores {
    param([switch]$StrictLink, [switch]$IncludeDuplicateSymbols)
    $always = @('4210', '4254')
    if ($IncludeDuplicateSymbols) { $always += '4006' }
    if ($StrictLink) { return $always }
    return $always + @('4088', '4253')
}

function Get-XdkLinkIgnoreArg {
    param([switch]$StrictLink, [switch]$IncludeDuplicateSymbols)
    $ids = Get-XdkLinkIgnores -StrictLink:$StrictLink -IncludeDuplicateSymbols:$IncludeDuplicateSymbols
    if (-not $ids -or $ids.Count -eq 0) { return @() }
    return @("/IGNORE:$($ids -join ',')")
}

function Get-XdkLinkIgnorePattern {
    param([switch]$StrictLink, [switch]$IncludeDuplicateSymbols)
    $ids = Get-XdkLinkIgnores -StrictLink:$StrictLink -IncludeDuplicateSymbols:$IncludeDuplicateSymbols
    return ($ids -join '|')
}
