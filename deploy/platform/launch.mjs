// Explicit first-deployment hold: no authentication, database writes or public APIs.
// Initialize the dedicated database through the private operator CLI, then redeploy
// with PLATFORM_BOOTSTRAP_ONLY=false. Normal startup still refuses missing schema.
if (process.env.PLATFORM_BOOTSTRAP_ONLY === "true") {
  const { createServer } = await import("node:http");
  createServer((_req, res) => {
    res.writeHead(503, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(
      JSON.stringify({ ready: false, message: "Platforma tayyorlanmoqda." })
    );
  }).listen(Number(process.env.PORT || 8080), "0.0.0.0");
} else {
  await import("./dist/platform.js");
}
