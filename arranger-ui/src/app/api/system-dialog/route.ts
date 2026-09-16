import { spawn } from "node:child_process";

import { NextResponse } from "next/server";

import { isLocalRequest } from "@/lib/server/local-request";
import { normalizeAbsolutePath } from "@/lib/server/managed-projects";

export const dynamic = "force-dynamic";

const OPEN_SCRIPT = `
$ProgressPreference = 'SilentlyContinue';
Add-Type -AssemblyName System.Windows.Forms;
[System.Windows.Forms.Application]::EnableVisualStyles();
$d = New-Object System.Windows.Forms.OpenFileDialog;
$d.AutoUpgradeEnabled = $true;
$d.Filter = 'Malody charts (*.mc;*.mcz)|*.mc;*.mcz';
$d.Multiselect = $false;
if ($env:ARRANGER_INITIAL_DIR) {
    if (Test-Path -LiteralPath $env:ARRANGER_INITIAL_DIR -PathType Container) {
        $d.InitialDirectory = $env:ARRANGER_INITIAL_DIR;
    } else {
        $parent = Split-Path -Parent $env:ARRANGER_INITIAL_DIR;
        if ($parent -and (Test-Path -LiteralPath $parent -PathType Container)) {
            $d.InitialDirectory = $parent;
        }
    }
}
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::OutputEncoding = [Text.Encoding]::UTF8;
    Write-Output $d.FileName;
}
`;

const SAVE_MC_SCRIPT = `
$ProgressPreference = 'SilentlyContinue';
Add-Type -AssemblyName System.Windows.Forms;
[System.Windows.Forms.Application]::EnableVisualStyles();
$d = New-Object System.Windows.Forms.SaveFileDialog;
$d.AutoUpgradeEnabled = $true;
$d.Filter = 'Malody chart (*.mc)|*.mc';
$d.DefaultExt = 'mc';
$d.AddExtension = $true;
$d.OverwritePrompt = $false;
if ($env:ARRANGER_INITIAL_DIR) {
    if (Test-Path -LiteralPath $env:ARRANGER_INITIAL_DIR -PathType Container) {
        $d.InitialDirectory = $env:ARRANGER_INITIAL_DIR;
    } else {
        $parent = Split-Path -Parent $env:ARRANGER_INITIAL_DIR;
        if ($parent -and (Test-Path -LiteralPath $parent -PathType Container)) {
            $d.InitialDirectory = $parent;
        }
    }
}
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::OutputEncoding = [Text.Encoding]::UTF8;
    Write-Output $d.FileName;
}
`;

const FOLDER_SCRIPT = `
$ProgressPreference = 'SilentlyContinue';
[Console]::OutputEncoding = [Text.Encoding]::UTF8;
Add-Type -AssemblyName System.Windows.Forms;
[System.Windows.Forms.Application]::EnableVisualStyles();

try {
    Add-Type -ReferencedAssemblies "System.Windows.Forms", "System.Drawing" -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace ModernFolderPicker {
    [ComImport]
    [Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
    [CoClass(typeof(FileOpenDialogClass))]
    public interface FileOpenDialog : IFileOpenDialog {}

    [ComImport]
    [Guid("D57C7288-D4AD-4768-BE02-9D969532D960")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IFileOpenDialog {
        [PreserveSig] int Show(IntPtr parent);
        void SetFileTypes();
        void SetFileTypeIndex();
        void GetFileTypeIndex();
        void Advise();
        void Unadvise();
        void SetOptions(uint fos);
        void GetOptions(out uint fos);
        void SetDefaultFolder(IShellItem psi);
        void SetFolder(IShellItem psi);
        void GetFolder(out IShellItem ppsi);
        void GetCurrentSelection(out IShellItem ppsi);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
        void GetResult(out IShellItem ppsi);
        void AddPlace();
        void SetDefaultExtension();
        void Close();
        void SetClientGuid();
        void ClearClientData();
        void SetFilter();
    }

    [ComImport]
    [Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IShellItem {
        void BindToHandler();
        void GetParent();
        void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
        void GetAttributes();
        void Compare();
    }

    [ComImport]
    [Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
    [ClassInterface(ClassInterfaceType.None)]
    public class FileOpenDialogClass {}

    public static class Picker {
        [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern int SHCreateItemFromParsingName(
            [MarshalAs(UnmanagedType.LPWStr)] string pszPath,
            IntPtr pbc,
            [In, MarshalAs(UnmanagedType.LPStruct)] Guid riid,
            [Out, MarshalAs(UnmanagedType.Interface)] out IShellItem ppv);

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        public static string ChooseFolder(string title, string initialDir) {
            var dialog = (IFileOpenDialog)new FileOpenDialogClass();
            uint options;
            dialog.GetOptions(out options);
            dialog.SetOptions(options | 0x20 | 0x40 | 0x800);
            if (!string.IsNullOrEmpty(title)) {
                dialog.SetTitle(title);
            }
            dialog.SetOkButtonLabel("选择文件夹");
            string folder = initialDir;
            if (!string.IsNullOrEmpty(folder)) {
                try {
                    while (!string.IsNullOrEmpty(folder) && !Directory.Exists(folder)) {
                        string parent = Path.GetDirectoryName(folder);
                        if (string.IsNullOrEmpty(parent) || parent == folder) {
                            if (folder.Length >= 2 && folder[1] == ':') {
                                string rootPath = folder.Substring(0, 2) + "\\";
                                if (Directory.Exists(rootPath)) folder = rootPath;
                                else folder = null;
                            } else {
                                folder = null;
                            }
                            break;
                        }
                        folder = parent;
                    }
                    if (!string.IsNullOrEmpty(folder) && Directory.Exists(folder)) {
                        IShellItem item;
                        Guid iid = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");
                        if (SHCreateItemFromParsingName(folder, IntPtr.Zero, iid, out item) == 0 && item != null) {
                            dialog.SetFolder(item);
                        }
                    }
                } catch {}
            }
            IntPtr owner = GetForegroundWindow();
            int hr = dialog.Show(owner);
            if (hr == 0) {
                IShellItem item;
                dialog.GetResult(out item);
                if (item != null) {
                    string path;
                    item.GetDisplayName(0x80058000, out path);
                    return path;
                }
            }
            return null;
        }
    }
}
'@
    $res = [ModernFolderPicker.Picker]::ChooseFolder('选择输出目录', $env:ARRANGER_INITIAL_DIR);
    if ($res) { Write-Output $res }
} catch {
    Add-Type -AssemblyName System.Windows.Forms;
    $d = New-Object System.Windows.Forms.FolderBrowserDialog;
    $d.Description = '选择输出目录';
    $d.RootFolder = [System.Environment+SpecialFolder]::MyComputer;
    $folder = $env:ARRANGER_INITIAL_DIR;
    while ($folder -and -not (Test-Path -LiteralPath $folder -PathType Container)) {
        $parent = Split-Path -Parent $folder;
        if (-not $parent -or $parent -eq $folder) {
            if ($folder -match '^[a-zA-Z]:') {
                $root = $folder.Substring(0, 2) + '\';
                if (Test-Path -LiteralPath $root -PathType Container) { $folder = $root; break; }
            }
            $folder = $null;
            break;
        }
        $folder = $parent;
    }
    if ($folder -and (Test-Path -LiteralPath $folder -PathType Container)) {
        $d.SelectedPath = $folder;
    }
    if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        Write-Output $d.SelectedPath;
    }
}
`;

function showDialog(kind: "open" | "folder" | "save-mc", initialDir: string | null): Promise<string> {
  return new Promise((resolve, reject) => {
    const script = kind === "open" ? OPEN_SCRIPT : kind === "save-mc" ? SAVE_MC_SCRIPT : FOLDER_SCRIPT;
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-STA", "-NonInteractive", "-EncodedCommand", encoded],
      {
        windowsHide: false,
        env: { ...process.env, ARRANGER_INITIAL_DIR: initialDir ?? "" },
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr.trim() || `选择器退出码 ${code}`));
      else resolve(stdout.trim());
    });
  });
}

export async function POST(req: Request) {
  if (!isLocalRequest(req)) {
    return NextResponse.json({ ok: false, error: "仅允许本机调用系统选择器" }, { status: 403 });
  }
  let kind: unknown;
  let initialDir: unknown;
  try { ({ kind, initialDir } = await req.json()); }
  catch { return NextResponse.json({ ok: false, error: "请求 JSON 无效" }, { status: 400 }); }
  if (kind === "open-file") kind = "open";
  if (kind === "directory") kind = "folder";
  if (kind !== "open" && kind !== "folder" && kind !== "save-mc") {
    return NextResponse.json({ ok: false, error: "kind 必须是 open/open-file、folder/directory 或 save-mc" }, { status: 400 });
  }
  let safeInitial: string | null = null;
  if (typeof initialDir === "string" && initialDir.trim()) {
    const cleanRaw = initialDir.trim().replace(/\\\\+/g, "\\");
    const normalized = normalizeAbsolutePath(cleanRaw);
    if (normalized.ok) {
      safeInitial = normalized.path;
    }
  }
  try {
    const selected = await showDialog(kind, safeInitial);
    return NextResponse.json({ ok: true, cancelled: !selected, path: selected || null });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
