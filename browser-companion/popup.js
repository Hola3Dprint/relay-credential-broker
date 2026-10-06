const status = document.getElementById("status");
chrome.runtime
  .sendMessage({ type: "relay-status" })
  .then((result) => {
    status.textContent =
      result.status === "PAIRED"
        ? "Paired · Relay is available"
        : result.status === "NOT_PAIRED"
          ? "Pair once with your local broker."
          : "Relay is unavailable. Start the local broker.";
  })
  .catch(() => {
    status.textContent = "Unable to check connection.";
  });
document.getElementById("pair").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.getElementById("code");
  const result = await chrome.runtime.sendMessage({
    type: "relay-pair",
    code: input.value,
  });
  input.value = "";
  status.textContent =
    result.status === "PAIRED"
      ? "Paired · ready to fill a focused login field"
      : result.reason;
});
