Set objShell = CreateObject("WScript.Shell")
objShell.Run "cmd /c node node_modules\electron\dist\electron .", 0, False
