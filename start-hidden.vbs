Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")
objShell.CurrentDirectory = objFSO.GetParentFolderName(WScript.ScriptFullName)
objShell.Run "node -e ""const{spawn}=require('child_process');spawn('node_modules\\electron\\dist\\electron.exe',['.'],{detached:true,stdio:'ignore'}).unref()""", 0, False
