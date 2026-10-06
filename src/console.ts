import { spawn } from "node:child_process";
import { Store } from "./store.js";
const store = await new Store().open();
const base = process.argv.includes("--dev")
  ? "http://127.0.0.1:5173"
  : "http://127.0.0.1:4318";
const url = `${base}/#token=${store.state.adminToken}`;
store.close();
// URL fragment never reaches the HTTP server; the console removes it immediately.
if (process.platform === "win32") {
  const p = spawn("rundll32.exe", ["url.dll,FileProtocolHandler", url], {
    windowsHide: true,
    stdio: "ignore",
  });
  p.on("error", () =>
    process.stderr.write("Could not open the console browser.\n"),
  );
} else {
  spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], {
    stdio: "ignore",
  });
}
