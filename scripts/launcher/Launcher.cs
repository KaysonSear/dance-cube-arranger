using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows.Forms;

namespace DanceCubeArrangerLauncher
{
    static class Program
    {
        const int KeptLaunchLogs = 10;

        static string WriteLaunchLog(string root, string output)
        {
            try
            {
                string directory = Path.Combine(root, @"artifacts\arranger");
                Directory.CreateDirectory(directory);
                string path = Path.Combine(directory, "editor-launch-" +
                    DateTime.UtcNow.ToString("yyyyMMdd-HHmmss-fff") + "-" + Process.GetCurrentProcess().Id + ".log");
                File.WriteAllText(path, output, Encoding.UTF8);
                string[] logs = Directory.GetFiles(directory, "editor-launch-*.log");
                Array.Sort(logs, StringComparer.Ordinal);
                for (int i = 0; i < logs.Length - KeptLaunchLogs; i++)
                {
                    try { File.Delete(logs[i]); } catch (IOException) { } catch (UnauthorizedAccessException) { }
                }
                return path;
            }
            catch (IOException) { return ""; }
            catch (UnauthorizedAccessException) { return ""; }
        }

        [STAThread]
        static int Main(string[] args)
        {
            bool quiet = Array.Exists(args, delegate(string arg) {
                return arg.Equals("/silent", StringComparison.OrdinalIgnoreCase) ||
                       arg.Equals("/q", StringComparison.OrdinalIgnoreCase);
            });
            string root = AppDomain.CurrentDomain.BaseDirectory;
            bool noBrowser = Array.Exists(args, delegate(string arg) {
                return arg.Equals("/no-browser", StringComparison.OrdinalIgnoreCase);
            });
            string logPath = "";
            try
            {
                string script = Path.Combine(root, @"scripts\editor_server.ps1");
                var start = new ProcessStartInfo
                {
                    FileName = Path.Combine(Environment.SystemDirectory, @"WindowsPowerShell\v1.0\powershell.exe"),
                    Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\" -Mode start" + (noBrowser ? " -NoBrowser" : ""),
                    WorkingDirectory = root,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    StandardOutputEncoding = Encoding.UTF8,
                    StandardErrorEncoding = Encoding.UTF8,
                };
                using (Process process = Process.Start(start))
                {
                    var output = new StringBuilder();
                    DataReceivedEventHandler capture = delegate(object sender, DataReceivedEventArgs eventArgs) {
                        if (eventArgs.Data != null) lock (output) { output.AppendLine(eventArgs.Data); }
                    };
                    process.OutputDataReceived += capture;
                    process.ErrorDataReceived += capture;
                    process.BeginOutputReadLine();
                    process.BeginErrorReadLine();
                    // Detached servers can inherit these pipes. Wait only for PowerShell.
                    if (!process.WaitForExit(30 * 60 * 1000))
                    {
                        process.Kill();
                        throw new TimeoutException("等待编辑器启动超时。");
                    }
                    System.Threading.Thread.Sleep(100);
                    string transcript;
                    lock (output) { transcript = output.ToString().Trim(); }
                    logPath = WriteLaunchLog(root, transcript);
                    if (process.ExitCode == 0) return 0;
                    throw new InvalidOperationException(transcript.Trim());
                }
            }
            catch (Exception error)
            {
                if (String.IsNullOrEmpty(logPath)) logPath = WriteLaunchLog(root, error.ToString());
                string detail = error.Message;
                if (!String.IsNullOrEmpty(logPath)) detail += Environment.NewLine + logPath;
                if (!quiet) MessageBox.Show(detail, "舞立方谱面编辑器", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }
    }
}
