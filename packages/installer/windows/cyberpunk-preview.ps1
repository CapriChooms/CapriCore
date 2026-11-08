# SPDX-License-Identifier: GPL-3.0-only
# This file is loaded only by the separately staged visual-preview wizard.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
if(-not ('Capri.Setup.Preview.Theme' -as [type])){
    Add-Type -Path @((Join-Path $PSScriptRoot 'cyberpunk-theme.cs'),(Join-Path $PSScriptRoot 'cyberpunk-preview.cs')) -ReferencedAssemblies 'System.Windows.Forms','System.Drawing'
}
function Initialize-CapriCyberpunkPreview($Form,$Sidebar,$Body,$Footer,$Brand,$ReleaseLabel,$Steps,$Back,$Next,$Cancel,$Pause){
    [Capri.Setup.Preview.Theme]::Attach($Form,$Sidebar,$Body,$Footer,$Brand,$ReleaseLabel,[Windows.Forms.Label[]]$Steps,$Back,$Next,$Cancel,$Pause)
}
function Update-CapriCyberpunkPreview($Form){
    [Capri.Setup.Preview.Theme]::Refresh($Form)
}
