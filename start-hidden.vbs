Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")
objShell.CurrentDirectory = objFSO.GetParentFolderName(WScript.ScriptFullName)
objShell.Run "node -e ""require('child_process').spawn(require('electron'),['.'],{detached:true,stdio:'ignore',windowsHide:true}).unref()""", 0, False
