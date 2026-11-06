$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$audioRoot = Join-Path (Get-Location) 'public/audio'
New-Item -ItemType Directory -Force -Path $audioRoot | Out-Null
$items = Get-Content -LiteralPath 'work/listening-scripts.json' -Raw -Encoding utf8 | ConvertFrom-Json
foreach ($item in $items) {
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $synth.SelectVoice($item.voice)
  $synth.Rate = 0
  $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $synth.SetOutputToWaveFile((Join-Path $audioRoot ($item.id + '.wav')), $format)
  $synth.Speak($item.text)
  $synth.Dispose()
}
Write-Output ('Generated ' + $items.Count + ' original French audio clips.')
