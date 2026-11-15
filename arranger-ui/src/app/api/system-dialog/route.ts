import { spawn } from "node:child_process";
import path from "node:path";

import { NextResponse } from "next/server";

import { diagnosticError } from "@/lib/server/diagnostics";
import { isLocalRequest } from "@/lib/server/local-request";
import { normalizeAbsolutePath } from "@/lib/server/managed-projects";

export const dynamic = "force-dynamic";

const DIALOG_TIMEOUT_MS = 180_000;
const DIALOG_PREAMBLE = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
if (-not [Environment]::UserInteractive) { exit 41 }
function Show-EditorFileDialog($Dialog) {
    $owner = New-Object System.Windows.Forms.Form
    try {
        $owner.TopMost = $true
        $owner.ShowInTaskbar = $false
        $owner.Opacity = 0
        $owner.Show()
        $owner.Activate()
        $Dialog.ShowDialog($owner)
    } finally {
        $owner.Dispose()
    }
}
`;

const OPEN_SCRIPT = DIALOG_PREAMBLE + `
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
$selected = $false
try {
    $selected = (Show-EditorFileDialog $d) -eq [System.Windows.Forms.DialogResult]::OK
    if ($selected) { Write-Output $d.FileName }
} finally {
    $d.Dispose()
}
`;

const SAVE_MC_SCRIPT = DIALOG_PREAMBLE + `
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
$selected = $false
try {
    $selected = (Show-EditorFileDialog $d) -eq [System.Windows.Forms.DialogResult]::OK
    if ($selected) { Write-Output $d.FileName }
} finally {
    $d.Dispose()
}
`;

const FOLDER_SCRIPT = DIALOG_PREAMBLE + `

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
    try {
        if ((Show-EditorFileDialog $d) -eq [System.Windows.Forms.DialogResult]::OK) {
            Write-Output $d.SelectedPath
        }
    } finally { $d.Dispose() }
}
`;

class DialogError extends Error {
  constructor(readonly code: string, readonly status: number, message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

let dialogPending = false;
function showDialog(kind: "open" | "folder" | "save-mc", initialDir: string | null, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    if (process.platform !== "win32") {
      reject(new DialogError("DIALOG_UNSUPPORTED", 501, "请在 Windows 桌面打开编辑器，或直接输入本机路径"));
      return;
    }
    const script = kind === "open" ? OPEN_SCRIPT : kind === "save-mc" ? SAVE_MC_SCRIPT : FOLDER_SCRIPT;
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const powershell = process.env.SystemRoot
      ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
      : "powershell.exe";
    const child = spawn(powershell, ["-NoProfile", "-STA", "-NonInteractive", "-EncodedCommand", encoded], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ARRANGER_INITIAL_DIR: initialDir ?? "" },
    });
    let stdout = "";
    let stderr = "";
    let stopped: DialogError | null = null;
    function stop(error: DialogError) {
      stopped ??= error;
      child.kill();
    }
    const cancel = () => stop(new DialogError("DIALOG_CANCELLED", 499, "已取消本次路径选择"));
    const timer = setTimeout(() => stop(new DialogError("DIALOG_TIMEOUT", 504, "选择窗口等待超时，请重试或手动输入路径")), DIALOG_TIMEOUT_MS);
    signal.addEventListener("abort", cancel, { once: true });
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-4000); });
    child.on("error", (cause) => {
      reject(new DialogError("DIALOG_START_FAILED", 500, "无法启动 Windows 选择窗口，请检查 PowerShell 或手动输入路径", { cause }));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      if (stopped) reject(stopped);
      else if (code === 41) reject(new DialogError("DIALOG_NO_DESKTOP", 503, "当前没有可交互的 Windows 桌面，请手动输入路径"));
      else if (code !== 0) reject(new DialogError("DIALOG_FAILED", 500, "Windows 选择窗口出错，请重试或手动输入路径", { cause: stderr }));
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
  const normalized = normalizeAbsolutePath(initialDir);
  if (dialogPending) return NextResponse.json({
    ok: false, code: "DIALOG_BUSY", error: "已有 Windows 选择窗口，请先完成或取消",
  }, { status: 409 });
  dialogPending = true;
  try {
    const selected = await showDialog(kind, normalized.ok ? normalized.path : null, req.signal);
    return NextResponse.json({ ok: true, cancelled: !selected, path: selected || null });
  } catch (error) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    if (error instanceof DialogError) return diagnosticError(error.code, error.message, error.status, error.cause);
    return diagnosticError("DIALOG_FAILED", "Windows 选择窗口出错，请手动输入路径", 500, error);
  } finally {
    dialogPending = false;
  }
}
