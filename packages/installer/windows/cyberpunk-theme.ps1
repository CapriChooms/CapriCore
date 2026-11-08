# SPDX-License-Identifier: GPL-3.0-only
# Native presentation only; installation choices and lifecycle stay in wizard-ui.ps1.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
if(-not ('Capri.Setup.Cyberpunk.Theme' -as [type])){
    Add-Type -Path (Join-Path $PSScriptRoot 'cyberpunk-theme.cs') -ReferencedAssemblies 'System.Windows.Forms','System.Drawing'
}
function Initialize-CapriCyberpunkTheme($Form,$Sidebar,$Body,$Footer,$Brand,$ReleaseLabel,$Steps,$Back,$Next,$Cancel,$Pause){
    [Capri.Setup.Cyberpunk.Theme]::Attach($Form,$Sidebar,$Body,$Footer,$Brand,$ReleaseLabel,[Windows.Forms.Label[]]$Steps,$Back,$Next,$Cancel,$Pause,$false)
}
function Update-CapriCyberpunkTheme($Form){
    [Capri.Setup.Cyberpunk.Theme]::Refresh($Form)
}
