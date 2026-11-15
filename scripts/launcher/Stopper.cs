using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows.Forms;

namespace DanceCubeArrangerStopper
{
    static class Program
    {
        [STAThread]
        static int Main(string[] args)
        {
            bool quiet = Array.Exists(args, delegate(string arg) {
                return arg.Equals("/silent", StringComparison.OrdinalIgnoreCase) ||
                       arg.Equals("/q", StringComparison.OrdinalIgnoreCase);
            });
            try
            {
                string root = AppDomain.CurrentDomain.BaseDirectory;
                string script = Path.Combine(root, @"scripts\editor_server.ps1");
                var start = new ProcessStartInfo
                {
                    FileName = Path.Combine(Environment.SystemDirectory, @"WindowsPowerShell\v1.0\powershell.exe"),
                    Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\" -Mode stop",
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
                    var output = process.StandardOutput.ReadToEndAsync();
                    var error = process.StandardError.ReadToEndAsync();
                    process.WaitForExit();
                    if (process.ExitCode == 0) return 0;
                    throw new InvalidOperationException(error.Result.Trim() + Environment.NewLine + output.Result.Trim());
                }
            }
            catch (Exception error)
            {
                if (!quiet) MessageBox.Show(error.Message, "舞立方谱面编辑器", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }
    }
}
