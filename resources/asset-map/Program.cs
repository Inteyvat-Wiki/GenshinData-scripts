// Compatibility launcher only. Generic map reading lives in resource-tools.
// Copyright (c) 2026 Inteyvat-Wiki. See resource-tools/NOTICES.md.
using System.Diagnostics;
if (args.Length != 3) throw new ArgumentException("Usage: AssetMap STUDIO MAP OUTPUT_JSON");
// Locate the calling repository from the compiled legacy launcher's directory.
var root = new DirectoryInfo(AppContext.BaseDirectory);
while (root != null && !File.Exists(Path.Combine(root.FullName, "package.json"))) root = root.Parent;
if (root == null) throw new InvalidOperationException("Cannot find package root; use resource-tools read-asset-map directly");
var start = new ProcessStartInfo("node") { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = root.FullName };
start.ArgumentList.Add("-e");
start.ArgumentList.Add("const r=require('@inteyvat-wiki/resource-tools').readAssetMap({studio:process.argv[1],map:process.argv[2],output:process.argv[3]});console.log('Exported '+r.entries.length+' image entries');");
foreach (var arg in args) start.ArgumentList.Add(Path.GetFullPath(arg));
using var process = Process.Start(start) ?? throw new InvalidOperationException("Cannot launch Node.js");
if (!process.WaitForExit(150000)) { process.Kill(true); throw new TimeoutException("Resource map reader timed out"); }
Environment.ExitCode = process.ExitCode;
