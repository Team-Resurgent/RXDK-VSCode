# stdin -> stdout: remove Cursor agent co-author trailers from commit messages.
$msg = [Console]::In.ReadToEnd()
if ([string]::IsNullOrEmpty($msg)) {
    return
}
$pattern = '(?m)^Co-authored-by:\s*Cursor\s*<cursoragent@cursor\.com>\s*\r?\n?'
$clean = [regex]::Replace($msg, $pattern, '')
Write-Output $clean.TrimEnd()
