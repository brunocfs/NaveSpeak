# Rode este script em PowerShell ABERTO COMO ADMINISTRADOR
# (botao direito no PowerShell -> "Executar como administrador")

New-NetFirewallRule -DisplayName "NaveSpeak client (Vite dev) TCP 5173" -Direction Inbound -Protocol TCP -LocalPort 5173 -Action Allow -Profile Any
New-NetFirewallRule -DisplayName "NaveSpeak server (API/socket) TCP 4100" -Direction Inbound -Protocol TCP -LocalPort 4100 -Action Allow -Profile Any
New-NetFirewallRule -DisplayName "NaveSpeak mediasoup RTC TCP 40000-40100" -Direction Inbound -Protocol TCP -LocalPort 40000-40100 -Action Allow -Profile Any
New-NetFirewallRule -DisplayName "NaveSpeak mediasoup RTC UDP 40000-40100" -Direction Inbound -Protocol UDP -LocalPort 40000-40100 -Action Allow -Profile Any

Write-Output "Regras criadas com sucesso."
