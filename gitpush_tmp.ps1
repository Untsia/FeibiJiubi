Set-Location 'E:\test\FeibiJiubi-PC'
git add -A
git commit -m 'fix: v1.6.0 source patches (db/gacha/background/ui)'
Write-Host '=== push ==='
git push 2>&1 | Out-String -Width 200 | Select-Object -First 10
