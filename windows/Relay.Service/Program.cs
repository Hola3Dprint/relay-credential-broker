using System.Diagnostics;
using System.ServiceProcess;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

if (args.Length != 1 || !File.Exists(args[0])) throw new ArgumentException("A local service configuration file is required.");
var config = JsonSerializer.Deserialize<RelayConfig>(File.ReadAllText(args[0]), new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? throw new InvalidOperationException("Invalid service configuration.");
ServiceBase.Run(new RelayService(config));

sealed record RelayConfig(string NodePath, string RepoPath, string DataPath, string? TunnelPath, string? TunnelProfile, string? TunnelProfileDir);
sealed class RelayService : ServiceBase {
    private readonly RelayConfig config;
    private readonly List<Process> children = [];
    private bool stopping;
    public RelayService(RelayConfig config) { this.config = config; ServiceName = "RelayCredentialBroker"; CanStop = true; }
    protected override void OnStart(string[] args) {
        StartChild(config.NodePath, [Path.Combine(config.RepoPath, "dist", "server", "server.js")], false);
        if (!string.IsNullOrEmpty(config.TunnelPath)) {
            var tunnelArgs = new List<string> { "run", "--profile", config.TunnelProfile ?? "relay" };
            if (!string.IsNullOrEmpty(config.TunnelProfileDir)) { tunnelArgs.Add("--profile-dir"); tunnelArgs.Add(config.TunnelProfileDir); }
            StartChild(config.TunnelPath, tunnelArgs.ToArray(), true);
        }
    }
    private void StartChild(string executable, string[] arguments, bool tunnel) {
        var start = new ProcessStartInfo(executable) { WorkingDirectory = config.RepoPath, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var value in arguments) start.ArgumentList.Add(value);
        start.Environment["RELAY_DATA_DIR"] = config.DataPath;
        if (tunnel) {
            var encrypted = File.ReadAllBytes(Path.Combine(config.DataPath, "tunnel-runtime.dpapi"));
            var key = ProtectedData.Unprotect(encrypted, Encoding.UTF8.GetBytes("Relay tunnel runtime v1"), DataProtectionScope.CurrentUser);
            try { start.Environment["CONTROL_PLANE_API_KEY"] = Encoding.UTF8.GetString(key); }
            finally { CryptographicOperations.ZeroMemory(key); }
        }
        var process = new Process { StartInfo = start, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, _) => { }; process.ErrorDataReceived += (_, _) => { };
        process.Exited += (_, _) => { if (!stopping) Environment.Exit(1); };
        children.Add(process); process.Start(); process.BeginOutputReadLine(); process.BeginErrorReadLine();
    }
    protected override void OnStop() {
        stopping = true;
        foreach (var process in children) { try { if (!process.HasExited) process.Kill(entireProcessTree: true); } catch { } process.Dispose(); }
        children.Clear();
    }
}
