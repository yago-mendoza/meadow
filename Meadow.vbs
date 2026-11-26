' Meadow: starts the server without a window (if it is not already running) and opens the browser.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Run "node server.mjs --open", 0, False
